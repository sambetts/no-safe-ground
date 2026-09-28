import type { SfxName } from './audio';
import {
  clamp,
  envelope,
  makeFilter,
  makeGain,
  makeNoiseBank,
  makeOsc,
  makeWaveShaper,
  midiToHz,
  type NoiseBank,
  noiseSource,
  rand,
  safeStop,
  scheduleKick,
  scheduleNoiseHit,
  scheduleSweepNoise,
  scheduleTone,
} from './dsp';

/** Long/expensive effects are rendered to buffers after unlock and played cheaply afterwards. */
export const HEAVY_SFX: readonly SfxName[] = [
  'explosion',
  'bigDie',
  'crash',
  'thunder',
  'lightning',
  'roar',
  'bossRoar',
  'engineRoar',
  'nightfall',
  'dawn',
  'victory',
  'defeat',
  'partPickup',
  'geyser',
];

const HEAVY_SET = new Set<SfxName>(HEAVY_SFX);

export interface SfxVoice {
  duration: number;
  extraNodes: AudioNode[];
}

/** Recipe synthesiser for all one-shot game/UI sounds. */
export class SfxSynth {
  private readonly rendered = new Map<SfxName, AudioBuffer>();
  private renderStarted = false;
  private xeniteCombo = 0;
  private lastXenite = -99;

  constructor(
    private readonly ctx: AudioContext,
    private readonly bank: NoiseBank,
  ) {}

  /** Render heavy sounds in the background; live recipes are still used until buffers arrive. */
  startPrerender(): void {
    if (this.renderStarted) return;
    this.renderStarted = true;

    for (const name of HEAVY_SFX) {
      void this.renderOne(name).catch(() => undefined);
    }
  }

  play(name: SfxName, output: GainNode, time: number, pitch: number, volume: number): SfxVoice {
    const buffer = this.rendered.get(name);
    if (buffer) {
      return this.playRendered(buffer, output, time, pitch);
    }

    const duration = this.recipe(this.ctx, this.bank, name, output, time, pitch, volume);
    return { duration, extraNodes: [] };
  }

  private playRendered(buffer: AudioBuffer, output: GainNode, time: number, pitch: number): SfxVoice {
    const source = this.ctx.createBufferSource();
    const amp = makeGain(this.ctx, 0);
    const rate = clamp(pitch, 0.45, 2.2);

    source.buffer = buffer;
    source.playbackRate.value = rate;
    envelope(amp.gain, time, 1, 0.004, buffer.duration / rate + 0.03);
    source.connect(amp).connect(output);
    source.start(time);
    safeStop(source, time + buffer.duration / rate + 0.08);

    return { duration: buffer.duration / rate, extraNodes: [source, amp] };
  }

  private async renderOne(name: SfxName): Promise<void> {
    if (typeof OfflineAudioContext === 'undefined') return;

    const duration = this.estimatedDuration(name) + 0.4;
    const sampleRate = this.ctx.sampleRate;
    const offline = new OfflineAudioContext(2, Math.ceil(duration * sampleRate), sampleRate);
    const offlineBank = makeNoiseBank(offline);
    const root = offline.createGain();

    root.gain.value = 0.95;
    root.connect(offline.destination);
    this.recipe(offline, offlineBank, name, root, 0.02, 1, 1);

    const buffer = await offline.startRendering();
    this.rendered.set(name, buffer);
  }

  private estimatedDuration(name: SfxName): number {
    switch (name) {
      case 'engineRoar': return 5;
      case 'victory': return 3.8;
      case 'defeat': return 3.6;
      case 'crash': return 3.1;
      case 'thunder': return 3.1;
      case 'nightfall':
      case 'dawn': return 3.2;
      case 'bossRoar': return 2.6;
      case 'partPickup': return 2.1;
      case 'lightning': return 2.2;
      case 'explosion':
      case 'geyser': return 1.6;
      case 'bigDie': return 1.15;
      case 'roar': return 0.95;
      default: return 1;
    }
  }

  private recipe(
    ctx: BaseAudioContext,
    bank: NoiseBank,
    name: SfxName,
    output: AudioNode,
    time: number,
    pitch: number,
    volume: number,
  ): number {
    switch (name) {
      case 'shoot': return this.plasmaShot(ctx, bank, output, time, pitch, 0.28, 760, 155, 0.28);
      case 'shootSpread': return this.plasmaShot(ctx, bank, output, time, pitch * 0.78, 0.38, 520, 105, 0.38);
      case 'turretShoot': return this.plasmaShot(ctx, bank, output, time, pitch * 1.35, 0.2, 1040, 260, 0.2);
      case 'teslaZap': return this.teslaZap(ctx, bank, output, time, pitch);
      case 'overheat': return this.overheat(ctx, bank, output, time, pitch);
      case 'cooled': return this.chirps(ctx, output, time, [720, 1080], 0.22, 'triangle', 0.22);
      case 'hit': return this.organicHit(ctx, bank, output, time, pitch, false);
      case 'hitArmor': return this.organicHit(ctx, bank, output, time, pitch, true);
      case 'enemyDie': return this.enemyDie(ctx, bank, output, time, pitch);
      case 'bigDie': return this.bigDie(ctx, bank, output, time, pitch);
      case 'playerHurt': return this.playerHurt(ctx, bank, output, time, pitch);
      case 'shieldBreak': return this.shieldBreak(ctx, bank, output, time, pitch);
      case 'dash': return this.dash(ctx, bank, output, time, pitch);
      case 'pickupScrap': return this.scrap(ctx, bank, output, time, pitch);
      case 'pickupXenite': return this.xenite(ctx, output, time, pitch);
      case 'pickupHealth': return this.health(ctx, output, time, pitch);
      case 'bulbPop': return this.bulbPop(ctx, bank, output, time, pitch);
      case 'partPickup': return this.partPickup(ctx, output, time, pitch);
      case 'install': return this.install(ctx, bank, output, time, pitch);
      case 'build': return this.build(ctx, bank, output, time, pitch);
      case 'upgrade': return this.upgrade(ctx, output, time, pitch);
      case 'explosion': return this.explosion(ctx, bank, output, time, pitch);
      case 'grenadeThrow': return this.grenadeThrow(ctx, bank, output, time, pitch);
      case 'mineBeep': return this.chirps(ctx, output, time, [1300], 0.09, 'sine', 0.18);
      case 'spit': return this.spit(ctx, bank, output, time, pitch);
      case 'acidSplash': return this.acidSplash(ctx, bank, output, time, pitch);
      case 'sporeRelease': return this.sporeRelease(ctx, bank, output, time, pitch);
      case 'roar': return this.roar(ctx, bank, output, time, pitch, 0.9, false);
      case 'charge': return this.charge(ctx, bank, output, time, pitch);
      case 'bossRoar': return this.bossRoar(ctx, bank, output, time, pitch);
      case 'burrow': return this.burrow(ctx, bank, output, time, pitch, false);
      case 'emerge': return this.burrow(ctx, bank, output, time, pitch, true);
      case 'nestSpawn': return this.nestSpawn(ctx, bank, output, time, pitch);
      case 'thunder': return this.thunder(ctx, bank, output, time, pitch, false);
      case 'lightning': return this.thunder(ctx, bank, output, time, pitch, true);
      case 'geyser': return this.geyser(ctx, bank, output, time, pitch);
      case 'uiClick': return this.chirps(ctx, output, time, [960], 0.055, 'square', 0.08 * volume);
      case 'uiHover': return this.chirps(ctx, output, time, [1240], 0.04, 'sine', 0.045 * volume);
      case 'uiError': return this.chirps(ctx, output, time, [190, 165], 0.34, 'sawtooth', 0.12 * volume);
      case 'uiOpen': return this.uiSwoosh(ctx, bank, output, time, pitch, true);
      case 'uiClose': return this.uiSwoosh(ctx, bank, output, time, pitch, false);
      case 'alarm': return this.alarm(ctx, output, time, pitch);
      case 'nightfall': return this.nightfall(ctx, bank, output, time, pitch);
      case 'dawn': return this.dawn(ctx, output, time, pitch);
      case 'o2Warning': return this.chirps(ctx, output, time, [1250, 1250], 0.28, 'square', 0.16);
      case 'heartbeat': return this.heartbeat(ctx, output, time, pitch);
      case 'shipHit': return this.shipHit(ctx, bank, output, time, pitch);
      case 'crash': return this.crash(ctx, bank, output, time, pitch);
      case 'engineRoar': return this.engineRoar(ctx, bank, output, time, pitch);
      case 'logFound': return this.logFound(ctx, bank, output, time, pitch);
      case 'step': return this.step(ctx, bank, output, time, pitch);
      case 'victory': return this.victory(ctx, output, time, pitch);
      case 'defeat': return this.defeat(ctx, bank, output, time, pitch);
    }
  }

  private plasmaShot(
    ctx: BaseAudioContext,
    bank: NoiseBank,
    output: AudioNode,
    time: number,
    pitch: number,
    duration: number,
    high: number,
    low: number,
    gainValue: number,
  ): number {
    const transient = makeOsc(ctx, 'square', high * 2.8 * pitch);
    const transientGain = makeGain(ctx, 0);
    envelope(transientGain.gain, time, gainValue * 0.32, 0.0015, 0.032);
    transient.connect(transientGain).connect(output);
    transient.start(time);
    safeStop(transient, time + 0.04);

    const body = makeOsc(ctx, 'sawtooth', high * pitch);
    const square = makeOsc(ctx, 'square', high * 0.51 * pitch);
    const bodyFilter = makeFilter(ctx, 'lowpass', high * 2.4, 1.3);
    const bodyGain = makeGain(ctx, 0);
    body.frequency.exponentialRampToValueAtTime(Math.max(20, low * pitch), time + duration * 0.72);
    square.frequency.exponentialRampToValueAtTime(Math.max(20, low * 0.5 * pitch), time + duration * 0.66);
    envelope(bodyGain.gain, time, gainValue, 0.007, duration);
    body.connect(bodyFilter);
    square.connect(bodyFilter);
    bodyFilter.connect(bodyGain).connect(output);
    body.start(time);
    square.start(time);
    safeStop(body, time + duration + 0.03);
    safeStop(square, time + duration + 0.03);

    scheduleKick(ctx, output, time, 72 * pitch, 38 * pitch, 0.1, gainValue * 0.18);
    scheduleNoiseHit(ctx, bank, output, time, 0.075, gainValue * 0.18, 'bandpass', high * 1.8, 2.5);
    return duration;
  }

  private teslaZap(ctx: BaseAudioContext, bank: NoiseBank, output: AudioNode, time: number, pitch: number): number {
    for (let i = 0; i < 10; i += 1) {
      const t = time + rand(0, 0.38);
      scheduleTone(ctx, output, t, rand(900, 3600) * pitch, rand(0.018, 0.055), 'square', rand(0.05, 0.12));
      scheduleNoiseHit(ctx, bank, output, t, rand(0.025, 0.09), rand(0.04, 0.11), 'bandpass', rand(900, 4800), rand(3, 9), 'crackle');
    }

    return 0.45;
  }

  private overheat(ctx: BaseAudioContext, bank: NoiseBank, output: AudioNode, time: number, pitch: number): number {
    scheduleSweepNoise(ctx, bank, output, time, 0.78, 0.2, 2100, 4200, 'highpass');

    const osc = makeOsc(ctx, 'sine', 930 * pitch);
    const amp = makeGain(ctx, 0);
    osc.frequency.exponentialRampToValueAtTime(210 * pitch, time + 0.78);
    envelope(amp.gain, time, 0.18, 0.04, 0.78);
    osc.connect(amp).connect(output);
    osc.start(time);
    safeStop(osc, time + 0.8);
    return 0.78;
  }

  private organicHit(
    ctx: BaseAudioContext,
    bank: NoiseBank,
    output: AudioNode,
    time: number,
    pitch: number,
    armored: boolean,
  ): number {
    const duration = armored ? 0.18 : 0.23;
    scheduleKick(ctx, output, time, armored ? 92 : 72, armored ? 38 : 44, duration, armored ? 0.15 : 0.28);
    scheduleNoiseHit(
      ctx,
      bank,
      output,
      time,
      duration * 0.78,
      armored ? 0.08 : 0.2,
      armored ? 'bandpass' : 'lowpass',
      armored ? 2100 : 720,
      armored ? 5 : 0.7,
    );
    scheduleTone(
      ctx,
      output,
      time + 0.018,
      (armored ? 1400 : 220) * pitch,
      armored ? 0.1 : 0.08,
      armored ? 'triangle' : 'sawtooth',
      armored ? 0.1 : 0.05,
    );

    if (armored) {
      for (const frequency of [1550, 2280, 3130]) {
        scheduleTone(ctx, output, time + rand(0, 0.025), frequency * pitch, 0.32, 'sine', 0.055);
      }
      return 0.38;
    }

    return duration;
  }

  private enemyDie(ctx: BaseAudioContext, bank: NoiseBank, output: AudioNode, time: number, pitch: number): number {
    this.formantNoise(ctx, bank, output, time, 0.28, 0.2, [420, 760, 1280]);
    scheduleKick(ctx, output, time, 120 * pitch, 50 * pitch, 0.22, 0.2);

    for (let i = 0; i < 6; i += 1) {
      scheduleTone(ctx, output, time + 0.08 + i * 0.034, rand(480, 980) * pitch, 0.035, 'square', 0.035);
    }

    return 0.44;
  }

  private bigDie(ctx: BaseAudioContext, bank: NoiseBank, output: AudioNode, time: number, pitch: number): number {
    this.roar(ctx, bank, output, time, pitch * 0.72, 0.95, true);
    this.formantNoise(ctx, bank, output, time + 0.45, 0.52, 0.24, [150, 340, 690]);

    for (let i = 0; i < 7; i += 1) {
      scheduleKick(ctx, output, time + 0.46 + i * 0.06, rand(90, 160), rand(35, 55), 0.12, 0.11);
    }

    return 1.15;
  }

  private playerHurt(ctx: BaseAudioContext, bank: NoiseBank, output: AudioNode, time: number, pitch: number): number {
    const shaper = makeWaveShaper(ctx, 30);
    const crunch = makeGain(ctx, 0);
    envelope(crunch.gain, time, 0.18, 0.006, 0.2);
    const crackle = noiseSource(ctx, bank, 'crackle');
    crackle.connect(shaper).connect(crunch).connect(output);
    crackle.start(time, rand(0, 1));
    safeStop(crackle, time + 0.22);

    scheduleKick(ctx, output, time, 95 * pitch, 32, 0.32, 0.35);
    scheduleNoiseHit(ctx, bank, output, time + 0.015, 0.25, 0.22, 'bandpass', 520, 1.8);
    return 0.38;
  }

  private shieldBreak(ctx: BaseAudioContext, bank: NoiseBank, output: AudioNode, time: number, pitch: number): number {
    for (let i = 0; i < 16; i += 1) {
      scheduleTone(ctx, output, time + rand(0, 0.16), rand(1300, 5600) * pitch, rand(0.08, 0.36), 'sine', rand(0.025, 0.07));
    }

    scheduleNoiseHit(ctx, bank, output, time, 0.38, 0.12, 'highpass', 2600, 0.8, 'crackle');
    return 0.56;
  }

  private dash(ctx: BaseAudioContext, bank: NoiseBank, output: AudioNode, time: number, pitch: number): number {
    scheduleSweepNoise(ctx, bank, output, time, 0.34, 0.28, 380 * pitch, 2300 * pitch);
    scheduleKick(ctx, output, time, 70, 44, 0.18, 0.14);
    return 0.34;
  }

  private scrap(ctx: BaseAudioContext, bank: NoiseBank, output: AudioNode, time: number, pitch: number): number {
    for (let i = 0; i < 3; i += 1) {
      scheduleTone(ctx, output, time + i * 0.045, rand(900, 2600) * pitch, rand(0.07, 0.18), 'triangle', 0.075 / (i + 1));
    }

    scheduleNoiseHit(ctx, bank, output, time, 0.09, 0.05, 'highpass', 2200, 1, 'crackle');
    return 0.28;
  }

  private xenite(ctx: BaseAudioContext, output: AudioNode, time: number, pitch: number): number {
    if (time - this.lastXenite > 0.6) this.xeniteCombo = 0;
    this.lastXenite = time;
    this.xeniteCombo = Math.min(7, this.xeniteCombo + 1);

    const base = 880 * pitch * 2 ** (this.xeniteCombo / 12);
    [1, 1.5, 2.01].forEach((ratio, index) => {
      scheduleTone(ctx, output, time + index * 0.025, base * ratio, 0.55 - index * 0.1, 'sine', 0.1 / (index + 1));
    });
    return 0.7;
  }

  private health(ctx: BaseAudioContext, output: AudioNode, time: number, pitch: number): number {
    [420, 560, 840].forEach((frequency, index) => {
      scheduleTone(ctx, output, time + index * 0.09, frequency * pitch, 0.28, 'sine', 0.09);
    });
    return 0.42;
  }

  private bulbPop(ctx: BaseAudioContext, bank: NoiseBank, output: AudioNode, time: number, pitch: number): number {
    scheduleKick(ctx, output, time, 180 * pitch, 70 * pitch, 0.12, 0.2);
    scheduleNoiseHit(ctx, bank, output, time + 0.035, 0.24, 0.13, 'highpass', 1500, 0.5);
    return 0.34;
  }

  private partPickup(ctx: BaseAudioContext, output: AudioNode, time: number, pitch: number): number {
    this.padChord(ctx, output, time, [36, 43, 48, 51], 1.9, 0.1, 'sawtooth');
    [0, 7, 12, 15, 19].forEach((note, index) => {
      scheduleTone(ctx, output, time + index * 0.22, midiToHz(48 + note) * pitch, 1.1, 'sine', 0.12);
    });
    return 2.1;
  }

  private install(ctx: BaseAudioContext, bank: NoiseBank, output: AudioNode, time: number, pitch: number): number {
    this.shipHit(ctx, bank, output, time, pitch);
    this.riser(ctx, output, time + 0.18, 1.2, 90 * pitch, 620 * pitch, 0.16);
    return 1.55;
  }

  private build(ctx: BaseAudioContext, bank: NoiseBank, output: AudioNode, time: number, pitch: number): number {
    for (let i = 0; i < 5; i += 1) {
      scheduleTone(ctx, output, time + i * 0.07, rand(500, 900) * pitch, 0.035, 'square', 0.06);
    }
    this.shipHit(ctx, bank, output, time + 0.42, pitch * 1.2);
    return 0.72;
  }

  private upgrade(ctx: BaseAudioContext, output: AudioNode, time: number, pitch: number): number {
    [0, 3, 7, 12, 15].forEach((note, index) => {
      scheduleTone(ctx, output, time + index * 0.09, midiToHz(60 + note) * pitch, 0.28, 'triangle', 0.105);
    });
    return 0.65;
  }

  private explosion(ctx: BaseAudioContext, bank: NoiseBank, output: AudioNode, time: number, pitch: number): number {
    scheduleKick(ctx, output, time, 68 * pitch, 24, 1.0, 0.68);
    scheduleKick(ctx, output, time + 0.04, 34 * pitch, 18, 1.2, 0.34);

    const shaper = makeWaveShaper(ctx, 24);
    const burst = noiseSource(ctx, bank, 'white');
    const burstFilter = makeFilter(ctx, 'lowpass', 780, 0.8);
    const burstGain = makeGain(ctx, 0);
    envelope(burstGain.gain, time, 0.34, 0.008, 0.75);
    burst.connect(shaper).connect(burstFilter).connect(burstGain).connect(output);
    burst.start(time, rand(0, 1));
    safeStop(burst, time + 0.82);

    for (let i = 0; i < 14; i += 1) {
      const t = time + 0.18 + rand(0, 1.05);
      scheduleNoiseHit(ctx, bank, output, t, rand(0.035, 0.16), rand(0.02, 0.055), 'bandpass', rand(900, 4200), 2.5, 'crackle');
    }

    scheduleNoiseHit(ctx, bank, output, time + 0.08, 1.35, 0.2, 'bandpass', 1300, 0.9);
    return 1.55;
  }

  private grenadeThrow(ctx: BaseAudioContext, bank: NoiseBank, output: AudioNode, time: number, pitch: number): number {
    scheduleKick(ctx, output, time, 170 * pitch, 82 * pitch, 0.15, 0.16);
    scheduleNoiseHit(ctx, bank, output, time, 0.12, 0.07, 'bandpass', 500, 1);
    return 0.22;
  }

  private spit(ctx: BaseAudioContext, bank: NoiseBank, output: AudioNode, time: number, pitch: number): number {
    scheduleNoiseHit(ctx, bank, output, time, 0.16, 0.18, 'bandpass', 720 * pitch, 1.5);
    scheduleKick(ctx, output, time, 240 * pitch, 95, 0.1, 0.12);
    return 0.22;
  }

  private acidSplash(ctx: BaseAudioContext, bank: NoiseBank, output: AudioNode, time: number, pitch: number): number {
    scheduleNoiseHit(ctx, bank, output, time, 0.55, 0.18, 'highpass', 2600 * pitch, 0.6, 'crackle');
    for (let i = 0; i < 8; i += 1) {
      scheduleTone(ctx, output, time + rand(0, 0.4), rand(1200, 3400), 0.025, 'square', 0.025);
    }
    return 0.62;
  }

  private sporeRelease(ctx: BaseAudioContext, bank: NoiseBank, output: AudioNode, time: number, pitch: number): number {
    scheduleKick(ctx, output, time, 90 * pitch, 55, 0.2, 0.09);
    scheduleNoiseHit(ctx, bank, output, time, 0.62, 0.12, 'lowpass', 1100, 0.5);
    return 0.7;
  }

  private roar(
    ctx: BaseAudioContext,
    bank: NoiseBank,
    output: AudioNode,
    time: number,
    pitch: number,
    duration: number,
    gritty: boolean,
  ): number {
    const body = makeOsc(ctx, 'sawtooth', 75 * pitch);
    const sub = makeOsc(ctx, 'sine', 38 * pitch);
    const shaper = gritty ? makeWaveShaper(ctx, 18) : undefined;
    const amp = makeGain(ctx, 0);
    const lowFormant = makeFilter(ctx, 'bandpass', 190, 1.2);
    const highFormant = makeFilter(ctx, 'bandpass', 520, 1.8);

    body.frequency.exponentialRampToValueAtTime(46 * pitch, time + duration);
    lowFormant.frequency.linearRampToValueAtTime(420, time + duration * 0.35);
    lowFormant.frequency.linearRampToValueAtTime(120, time + duration);
    highFormant.frequency.linearRampToValueAtTime(760, time + duration * 0.4);
    highFormant.frequency.linearRampToValueAtTime(280, time + duration);
    envelope(amp.gain, time, 0.32, duration * 0.18, duration);

    if (shaper) {
      body.connect(shaper).connect(lowFormant).connect(amp).connect(output);
    } else {
      body.connect(lowFormant).connect(amp).connect(output);
    }
    sub.connect(amp);
    body.connect(highFormant).connect(amp);
    body.start(time);
    sub.start(time);
    safeStop(body, time + duration + 0.04);
    safeStop(sub, time + duration + 0.04);

    scheduleNoiseHit(ctx, bank, output, time, duration, 0.16, 'bandpass', 280, 1.4);
    return duration + 0.06;
  }

  private charge(ctx: BaseAudioContext, bank: NoiseBank, output: AudioNode, time: number, pitch: number): number {
    for (let i = 0; i < 5; i += 1) {
      scheduleKick(ctx, output, time + i * 0.13, 80 * pitch, 34, 0.16, 0.24 - i * 0.02);
    }
    scheduleNoiseHit(ctx, bank, output, time, 0.72, 0.08, 'lowpass', 300, 0.6);
    return 0.82;
  }

  private bossRoar(ctx: BaseAudioContext, bank: NoiseBank, output: AudioNode, time: number, pitch: number): number {
    this.roar(ctx, bank, output, time, pitch * 0.55, 2.15, true);
    this.roar(ctx, bank, output, time + 0.18, pitch * 0.82, 1.7, true);
    this.formantNoise(ctx, bank, output, time, 2.35, 0.24, [110, 190, 430, 760]);
    scheduleKick(ctx, output, time + 1.6, 46, 18, 0.7, 0.32);
    return 2.55;
  }

  private burrow(ctx: BaseAudioContext, bank: NoiseBank, output: AudioNode, time: number, pitch: number, emerge: boolean): number {
    const duration = emerge ? 0.95 : 0.78;
    scheduleNoiseHit(ctx, bank, output, time, duration, emerge ? 0.28 : 0.18, 'lowpass', emerge ? 900 : 420, 0.8);

    for (let i = 0; i < (emerge ? 6 : 4); i += 1) {
      scheduleKick(ctx, output, time + i * 0.11, rand(70, 120) * pitch, 35, 0.13, 0.12);
    }

    if (emerge) this.explosion(ctx, bank, output, time + 0.38, pitch * 0.8);
    return duration + (emerge ? 0.25 : 0);
  }

  private nestSpawn(ctx: BaseAudioContext, bank: NoiseBank, output: AudioNode, time: number, pitch: number): number {
    this.formantNoise(ctx, bank, output, time, 0.4, 0.18, [360, 700, 1100]);
    for (let i = 0; i < 4; i += 1) {
      scheduleTone(ctx, output, time + i * 0.06, rand(180, 340) * pitch, 0.08, 'sawtooth', 0.05);
    }
    return 0.48;
  }

  private thunder(ctx: BaseAudioContext, bank: NoiseBank, output: AudioNode, time: number, pitch: number, crack: boolean): number {
    const duration = crack ? 2.2 : 3.1;
    if (crack) scheduleNoiseHit(ctx, bank, output, time, 0.08, 0.5, 'highpass', 1800, 0.7);

    for (let i = 0; i < 5; i += 1) {
      const t = time + (crack ? 0.12 : 0) + i * rand(0.28, 0.46);
      scheduleKick(ctx, output, t, rand(36, 65) * pitch, 20, 0.75, 0.24 / (i + 0.8));
      scheduleNoiseHit(ctx, bank, output, time + i * 0.35, 0.8, 0.09, 'lowpass', rand(120, 360), 0.8);
    }

    return duration;
  }

  private geyser(ctx: BaseAudioContext, bank: NoiseBank, output: AudioNode, time: number, pitch: number): number {
    scheduleKick(ctx, output, time, 95 * pitch, 48, 0.3, 0.24);
    scheduleSweepNoise(ctx, bank, output, time, 1.4, 0.36, 520, 3200, 'highpass');
    return 1.55;
  }

  private uiSwoosh(ctx: BaseAudioContext, bank: NoiseBank, output: AudioNode, time: number, pitch: number, up: boolean): number {
    scheduleSweepNoise(ctx, bank, output, time, 0.24, 0.1, up ? 420 * pitch : 1800 * pitch, up ? 1800 * pitch : 420 * pitch);
    return 0.24;
  }

  private alarm(ctx: BaseAudioContext, output: AudioNode, time: number, pitch: number): number {
    scheduleTone(ctx, output, time, 420 * pitch, 0.36, 'sawtooth', 0.15);
    scheduleTone(ctx, output, time + 0.48, 420 * pitch, 0.36, 'sawtooth', 0.15);
    return 1;
  }

  private nightfall(ctx: BaseAudioContext, bank: NoiseBank, output: AudioNode, time: number, pitch: number): number {
    this.padChord(ctx, output, time, [32, 35, 39, 46], 2.9, 0.18, 'sawtooth');
    scheduleNoiseHit(ctx, bank, output, time + 0.5, 2.2, 0.12, 'bandpass', 180, 1.8);
    scheduleKick(ctx, output, time + 2.45, 58 * pitch, 24, 0.5, 0.32);
    return 3.1;
  }

  private dawn(ctx: BaseAudioContext, output: AudioNode, time: number, pitch: number): number {
    this.padChord(ctx, output, time, [48, 52, 55, 60], 3, 0.14, 'triangle');
    [0, 4, 7, 12].forEach((note, index) => {
      scheduleTone(ctx, output, time + 0.7 + index * 0.28, midiToHz(60 + note) * pitch, 1.2, 'sine', 0.08);
    });
    return 3.2;
  }

  private heartbeat(ctx: BaseAudioContext, output: AudioNode, time: number, pitch: number): number {
    scheduleKick(ctx, output, time, 72 * pitch, 38, 0.16, 0.24);
    scheduleKick(ctx, output, time + 0.22, 63 * pitch, 33, 0.2, 0.19);
    return 0.55;
  }

  private shipHit(ctx: BaseAudioContext, bank: NoiseBank, output: AudioNode, time: number, pitch: number): number {
    scheduleKick(ctx, output, time, 95 * pitch, 36, 0.45, 0.36);
    scheduleNoiseHit(ctx, bank, output, time, 0.5, 0.2, 'bandpass', 480, 1.1, 'crackle');

    for (const frequency of [620, 910, 1320]) {
      scheduleTone(ctx, output, time + rand(0, 0.04), frequency * pitch, 0.42, 'triangle', 0.06);
    }

    return 0.62;
  }

  private crash(ctx: BaseAudioContext, bank: NoiseBank, output: AudioNode, time: number, pitch: number): number {
    this.explosion(ctx, bank, output, time, pitch * 0.75);
    scheduleKick(ctx, output, time + 0.62, 42, 18, 1.5, 0.45);

    for (let i = 0; i < 12; i += 1) {
      scheduleTone(ctx, output, time + rand(0.25, 2.4), rand(300, 1800) * pitch, rand(0.05, 0.28), 'triangle', rand(0.025, 0.08));
    }

    for (const frequency of [210, 330, 510]) {
      scheduleNoiseHit(ctx, bank, output, time + 0.4, 2.1, 0.08, 'bandpass', frequency, 9, 'white');
    }

    scheduleNoiseHit(ctx, bank, output, time + 0.15, 2.65, 0.26, 'bandpass', 700, 0.6, 'crackle');
    return 3.05;
  }

  private engineRoar(ctx: BaseAudioContext, bank: NoiseBank, output: AudioNode, time: number, pitch: number): number {
    this.riser(ctx, output, time, 5, 42 * pitch, 92 * pitch, 0.46);
    scheduleSweepNoise(ctx, bank, output, time + 0.2, 4.8, 0.22, 300, 1300, 'lowpass');
    scheduleKick(ctx, output, time + 3.8, 74, 36, 0.7, 0.26);
    return 5;
  }

  private logFound(ctx: BaseAudioContext, bank: NoiseBank, output: AudioNode, time: number, pitch: number): number {
    [900, 1200, 780, 1600].forEach((frequency, index) => {
      scheduleTone(ctx, output, time + index * 0.055, frequency * pitch, 0.05, 'square', 0.055);
    });
    scheduleNoiseHit(ctx, bank, output, time + 0.16, 0.28, 0.06, 'bandpass', 2600, 0.7, 'crackle');
    return 0.55;
  }

  private step(ctx: BaseAudioContext, bank: NoiseBank, output: AudioNode, time: number, pitch: number): number {
    scheduleNoiseHit(ctx, bank, output, time, 0.09, 0.055, 'bandpass', rand(700, 1100) * pitch, 0.9);
    scheduleKick(ctx, output, time, 95 * pitch, 70, 0.06, 0.035);
    return 0.13;
  }

  private victory(ctx: BaseAudioContext, output: AudioNode, time: number, pitch: number): number {
    this.padChord(ctx, output, time, [48, 52, 55, 60], 3.6, 0.12, 'triangle');
    [0, 4, 7, 12, 16, 19].forEach((note, index) => {
      scheduleTone(ctx, output, time + index * 0.25, midiToHz(60 + note) * pitch, 1.1, 'sine', 0.09);
    });
    return 3.8;
  }

  private defeat(ctx: BaseAudioContext, bank: NoiseBank, output: AudioNode, time: number, pitch: number): number {
    this.padChord(ctx, output, time, [40, 39, 35, 34], 3.4, 0.13, 'sawtooth');
    [48, 43, 39, 34].forEach((note, index) => {
      scheduleTone(ctx, output, time + index * 0.45, midiToHz(note) * pitch, 0.8, 'triangle', 0.08);
    });
    scheduleNoiseHit(ctx, bank, output, time + 0.6, 2.4, 0.06, 'lowpass', 240, 0.8);
    return 3.6;
  }

  private chirps(
    ctx: BaseAudioContext,
    output: AudioNode,
    time: number,
    frequencies: readonly number[],
    total: number,
    type: OscillatorType,
    gainValue: number,
  ): number {
    const step = total / Math.max(1, frequencies.length);
    frequencies.forEach((frequency, index) => {
      scheduleTone(ctx, output, time + index * step, frequency, Math.min(0.2, step * 0.9), type, gainValue);
    });
    return total;
  }

  private riser(
    ctx: BaseAudioContext,
    output: AudioNode,
    time: number,
    duration: number,
    from: number,
    to: number,
    gainValue: number,
  ): void {
    const osc = makeOsc(ctx, 'sawtooth', from);
    const filter = makeFilter(ctx, 'lowpass', Math.max(160, from * 4), 1);
    const amp = makeGain(ctx, 0);

    osc.frequency.exponentialRampToValueAtTime(Math.max(20, to), time + duration);
    filter.frequency.exponentialRampToValueAtTime(Math.max(2200, to * 3), time + duration);
    envelope(amp.gain, time, gainValue, duration * 0.55, duration);
    osc.connect(filter).connect(amp).connect(output);
    osc.start(time);
    safeStop(osc, time + duration + 0.05);
  }

  private padChord(
    ctx: BaseAudioContext,
    output: AudioNode,
    time: number,
    notes: readonly number[],
    duration: number,
    gainValue: number,
    type: OscillatorType,
  ): void {
    notes.forEach((note, index) => {
      for (let detune = -1; detune <= 1; detune += 1) {
        const osc = makeOsc(ctx, type, midiToHz(note) * (1 + detune * 0.003 + (index - 1.5) * 0.001));
        const filter = makeFilter(ctx, 'lowpass', 850 + index * 180, 0.8);
        const amp = makeGain(ctx, 0);
        envelope(amp.gain, time, gainValue / (notes.length * 2.4), duration * 0.22, duration);
        osc.connect(filter).connect(amp).connect(output);
        osc.start(time);
        safeStop(osc, time + duration + 0.1);
      }
    });
  }

  private formantNoise(
    ctx: BaseAudioContext,
    bank: NoiseBank,
    output: AudioNode,
    time: number,
    duration: number,
    gainValue: number,
    formants: readonly number[],
  ): void {
    for (const frequency of formants) {
      scheduleNoiseHit(ctx, bank, output, time, duration, gainValue / formants.length, 'bandpass', frequency, 5);
    }
  }
}

export function isHeavySfx(name: SfxName): boolean {
  return HEAVY_SET.has(name);
}

