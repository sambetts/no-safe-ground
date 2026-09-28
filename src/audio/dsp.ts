/** Shared Web Audio helpers for the procedural synthesiser. */

export type NoiseKind = 'white' | 'crackle';

export interface NoiseBank {
  white: AudioBuffer;
  crackle: AudioBuffer;
}

export const clamp = (value: number, min = 0, max = 1): number => {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
};

export const rand = (min = 0, max = 1): number => min + Math.random() * (max - min);

export const choose = <T>(items: readonly T[]): T => {
  return items[Math.floor(Math.random() * items.length)] ?? items[0];
};

export const midiToHz = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);

export function safeStop(source: AudioScheduledSourceNode, time: number): void {
  try {
    source.stop(time);
  } catch {
    // Already stopped.
  }
}

export function envelope(
  param: AudioParam,
  time: number,
  peak: number,
  attack: number,
  duration: number,
  end = 0.0001,
): void {
  const safeAttack = Math.max(0.001, attack);
  const safeDuration = Math.max(safeAttack + 0.002, duration);

  param.cancelScheduledValues(time);
  param.setValueAtTime(0.0001, time);
  param.linearRampToValueAtTime(Math.max(0.0001, peak), time + safeAttack);
  param.exponentialRampToValueAtTime(Math.max(0.0001, end), time + safeDuration);
}

export function holdEnvelope(
  param: AudioParam,
  time: number,
  peak: number,
  attack: number,
  hold: number,
  release: number,
): void {
  param.cancelScheduledValues(time);
  param.setValueAtTime(0.0001, time);
  param.linearRampToValueAtTime(Math.max(0.0001, peak), time + Math.max(0.001, attack));
  param.setTargetAtTime(0.0001, time + attack + hold, Math.max(0.01, release / 3));
}

export function makeGain(ctx: BaseAudioContext, value = 1): GainNode {
  const gain = ctx.createGain();
  gain.gain.value = value;
  return gain;
}

export function makeFilter(
  ctx: BaseAudioContext,
  type: BiquadFilterType,
  frequency: number,
  q = 0.7,
): BiquadFilterNode {
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = Math.max(20, frequency);
  filter.Q.value = q;
  return filter;
}

export function makeOsc(
  ctx: BaseAudioContext,
  type: OscillatorType,
  frequency: number,
): OscillatorNode {
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.value = Math.max(0.001, frequency);
  return osc;
}

export function connectChain(nodes: AudioNode[]): void {
  for (let i = 0; i < nodes.length - 1; i += 1) {
    nodes[i]?.connect(nodes[i + 1] as AudioNode);
  }
}

export function makeNoiseBuffer(ctx: BaseAudioContext, seconds: number, kind: NoiseKind): AudioBuffer {
  const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let brown = 0;

  for (let i = 0; i < length; i += 1) {
    const white = Math.random() * 2 - 1;
    brown = brown * 0.985 + white * 0.15;

    if (kind === 'crackle') {
      const impulse = Math.random() > 0.965 ? white : white * 0.02;
      data[i] = impulse + brown * 0.04;
    } else {
      data[i] = white * 0.68 + brown * 0.32;
    }
  }

  return buffer;
}

export function makeNoiseBank(ctx: BaseAudioContext): NoiseBank {
  return {
    white: makeNoiseBuffer(ctx, 4, 'white'),
    crackle: makeNoiseBuffer(ctx, 3, 'crackle'),
  };
}

export function noiseSource(ctx: BaseAudioContext, bank: NoiseBank, kind: NoiseKind, loop = false): AudioBufferSourceNode {
  const source = ctx.createBufferSource();
  source.buffer = kind === 'white' ? bank.white : bank.crackle;
  source.loop = loop;
  return source;
}

export function makeImpulse(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);

  for (let channel = 0; channel < 2; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < length; i += 1) {
      const decay = (1 - i / length) ** 2.35;
      data[i] = (Math.random() * 2 - 1) * decay * (channel === 0 ? 1 : 0.92);
    }
  }

  return buffer;
}

export function distortionCurve(amount: number): Float32Array<ArrayBuffer> {
  const length = 1024;
  const curve = new Float32Array(new ArrayBuffer(length * 4));
  const k = Math.max(0.01, amount);

  for (let i = 0; i < length; i += 1) {
    const x = (i * 2) / length - 1;
    curve[i] = ((3 + k) * x * 20 * (Math.PI / 180)) / (Math.PI + k * Math.abs(x));
  }

  return curve;
}

export function makeWaveShaper(ctx: BaseAudioContext, amount: number): WaveShaperNode {
  const shaper = ctx.createWaveShaper();
  shaper.curve = distortionCurve(amount);
  shaper.oversample = '2x';
  return shaper;
}

export function scheduleTone(
  ctx: BaseAudioContext,
  destination: AudioNode,
  time: number,
  frequency: number,
  duration: number,
  type: OscillatorType,
  gainValue: number,
): void {
  const osc = makeOsc(ctx, type, frequency);
  const amp = makeGain(ctx, 0);
  envelope(amp.gain, time, gainValue, Math.min(0.02, duration * 0.25), duration);
  osc.connect(amp).connect(destination);
  osc.start(time);
  safeStop(osc, time + duration + 0.03);
}

export function scheduleKick(
  ctx: BaseAudioContext,
  destination: AudioNode,
  time: number,
  high: number,
  low: number,
  duration: number,
  gainValue: number,
): void {
  const osc = makeOsc(ctx, 'sine', high);
  const amp = makeGain(ctx, 0);
  osc.frequency.exponentialRampToValueAtTime(Math.max(18, low), time + duration * 0.86);
  envelope(amp.gain, time, gainValue, 0.008, duration);
  osc.connect(amp).connect(destination);
  osc.start(time);
  safeStop(osc, time + duration + 0.03);
}

export function scheduleNoiseHit(
  ctx: BaseAudioContext,
  bank: NoiseBank,
  destination: AudioNode,
  time: number,
  duration: number,
  gainValue: number,
  filterType: BiquadFilterType,
  frequency: number,
  q = 0.9,
  kind: NoiseKind = 'white',
): void {
  const source = noiseSource(ctx, bank, kind);
  const filter = makeFilter(ctx, filterType, frequency, q);
  const amp = makeGain(ctx, 0);

  envelope(amp.gain, time, gainValue, Math.min(0.04, duration * 0.2), duration);
  source.connect(filter).connect(amp).connect(destination);
  source.start(time, rand(0, 1));
  safeStop(source, time + duration + 0.03);
}

export function scheduleSweepNoise(
  ctx: BaseAudioContext,
  bank: NoiseBank,
  destination: AudioNode,
  time: number,
  duration: number,
  gainValue: number,
  from: number,
  to: number,
  filterType: BiquadFilterType = 'bandpass',
): void {
  const source = noiseSource(ctx, bank, 'white');
  const filter = makeFilter(ctx, filterType, from, 0.9);
  const amp = makeGain(ctx, 0);

  filter.frequency.exponentialRampToValueAtTime(Math.max(20, to), time + duration);
  envelope(amp.gain, time, gainValue, 0.04, duration);
  source.connect(filter).connect(amp).connect(destination);
  source.start(time, rand(0, 1));
  safeStop(source, time + duration + 0.03);
}


