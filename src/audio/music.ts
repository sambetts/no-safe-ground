import type { MusicMood } from './audio';
import {
  choose,
  clamp,
  envelope,
  holdEnvelope,
  makeFilter,
  makeGain,
  makeOsc,
  midiToHz,
  rand,
  safeStop,
  scheduleKick,
  scheduleNoiseHit,
  scheduleTone,
  type NoiseBank,
} from './dsp';

interface MoodConfig {
  bpm: number;
  key: number;
  scale: readonly number[];
  density: number;
  chords: readonly (readonly number[])[];
}

interface MoodState {
  mood: MusicMood;
  root: GainNode;
  nextStep: number;
  step: number;
  bar: number;
  padNext: number;
  textureNext: number;
  motifNext: number;
  stopAt: number;
}

const LOOKAHEAD_SECONDS = 0.38;
const KESSRA_MOTIF: readonly number[] = [0, 3, 2, -2, 5, 1];

const MOODS: Record<MusicMood, MoodConfig> = {
  silent: { bpm: 60, key: 45, scale: [0], density: 0, chords: [[0]] },
  title: {
    bpm: 64,
    key: 38,
    scale: [0, 2, 3, 7, 10],
    density: 0.24,
    chords: [[0, 3, 7, 10], [-5, 2, 7, 10], [-2, 3, 7, 12], [-7, 0, 5, 10]],
  },
  explore: {
    bpm: 72,
    key: 41,
    scale: [0, 2, 3, 5, 7, 10],
    density: 0.35,
    chords: [[0, 3, 7, 10], [3, 7, 10, 14], [-2, 3, 5, 10], [5, 7, 12, 15]],
  },
  dusk: {
    bpm: 78,
    key: 40,
    scale: [0, 1, 3, 5, 7, 8, 10],
    density: 0.52,
    chords: [[0, 3, 7, 10], [1, 5, 8, 12], [-4, 0, 5, 8], [-1, 3, 6, 10]],
  },
  night: {
    bpm: 104,
    key: 37,
    scale: [0, 2, 3, 5, 7, 8, 10],
    density: 0.8,
    chords: [[0, 3, 7, 10], [-2, 3, 7, 8], [1, 5, 8, 10], [-5, 0, 3, 7]],
  },
  boss: {
    bpm: 132,
    key: 34,
    scale: [0, 1, 3, 6, 7, 10],
    density: 1,
    chords: [[0, 1, 6, 10], [1, 6, 7, 13], [6, 10, 13, 18], [-2, 3, 6, 10]],
  },
  launch: {
    bpm: 118,
    key: 43,
    scale: [0, 2, 4, 5, 7, 9, 11],
    density: 0.85,
    chords: [[0, 4, 7, 12], [5, 9, 12, 16], [7, 11, 14, 19], [9, 12, 16, 21]],
  },
  victory: {
    bpm: 86,
    key: 48,
    scale: [0, 2, 4, 5, 7, 9, 11],
    density: 0.45,
    chords: [[0, 4, 7, 12], [5, 9, 12, 16], [7, 11, 14, 19], [0, 4, 7, 12]],
  },
  gameover: {
    bpm: 58,
    key: 36,
    scale: [0, 2, 3, 5, 6, 8, 10],
    density: 0.2,
    chords: [[0, 3, 6, 10], [-1, 3, 6, 8], [-5, 0, 3, 6], [-7, -1, 3, 5]],
  },
};

/** Adaptive generative score with mood crossfades, motif, delay and intensity layers. */
export class GenerativeMusic {
  private readonly states: MoodState[] = [];
  private readonly delayInput: GainNode;
  private readonly delay: DelayNode;
  private readonly feedback: GainNode;
  private readonly feedbackFilter: BiquadFilterNode;
  private currentMood: MusicMood = 'silent';
  private intensity = 0;
  private targetIntensity = 0;

  constructor(
    private readonly ctx: AudioContext,
    private readonly output: GainNode,
    private readonly bank: NoiseBank,
    reverbSend?: GainNode,
  ) {
    this.delayInput = makeGain(ctx, 0.55);
    this.delay = ctx.createDelay(1.5);
    this.feedback = makeGain(ctx, 0.32);
    this.feedbackFilter = makeFilter(ctx, 'lowpass', 2600, 0.4);

    this.delay.delayTime.value = 0.38;
    this.delayInput.connect(this.delay);
    this.delay.connect(this.feedbackFilter).connect(this.feedback).connect(this.delay);
    this.delay.connect(output);
    if (reverbSend) this.delay.connect(reverbSend);
  }

  setMood(mood: MusicMood): void {
    if (this.currentMood === mood) return;
    this.currentMood = mood;

    if (mood === 'silent') {
      for (const state of this.states) this.fadeOut(state, 2.5);
      return;
    }

    this.startMood(mood, 2.4);
  }

  setIntensity(value: number): void {
    this.targetIntensity = clamp(value);
  }

  update(dt: number): void {
    const smoothing = 1 - Math.exp(-clamp(dt, 0, 0.2) * 4);
    this.intensity += (this.targetIntensity - this.intensity) * smoothing;
    this.schedule(this.ctx.currentTime);
  }

  private startMood(mood: MusicMood, fadeSeconds: number): void {
    for (const state of this.states) this.fadeOut(state, fadeSeconds);

    const root = makeGain(this.ctx, 0.0001);
    root.connect(this.output);
    root.connect(this.delayInput);

    const now = this.ctx.currentTime;
    const state: MoodState = {
      mood,
      root,
      nextStep: now + 0.04,
      step: 0,
      bar: 0,
      padNext: now,
      textureNext: now + rand(1, 3),
      motifNext: now + (mood === 'title' ? 0.6 : 2.2),
      stopAt: Infinity,
    };

    this.states.push(state);
    root.gain.setTargetAtTime(0.82, now, Math.max(0.02, fadeSeconds / 3));
  }

  private fadeOut(state: MoodState, seconds: number): void {
    if (state.stopAt !== Infinity) return;

    const now = this.ctx.currentTime;
    state.stopAt = now + seconds + 0.8;
    state.root.gain.setTargetAtTime(0.0001, now, Math.max(0.03, seconds / 3));
    window.setTimeout(() => {
      try {
        state.root.disconnect();
      } catch {
        // Already disconnected.
      }
    }, (seconds + 1.2) * 1000);
  }

  private schedule(now: number): void {
    for (let i = this.states.length - 1; i >= 0; i -= 1) {
      if (this.states[i]?.stopAt <= now) this.states.splice(i, 1);
    }

    for (const state of this.states) {
      while (state.nextStep < now + LOOKAHEAD_SECONDS) this.scheduleStep(state);
      if (state.padNext < now + LOOKAHEAD_SECONDS) this.schedulePad(state);
      if (state.textureNext < now + LOOKAHEAD_SECONDS) this.scheduleTexture(state);
      if (state.motifNext < now + LOOKAHEAD_SECONDS) this.scheduleMotif(state);
    }
  }

  private scheduleStep(state: MoodState): void {
    const cfg = MOODS[state.mood];
    const stepLength = (60 / cfg.bpm) / 4;
    const time = state.nextStep;
    const stepInBar = state.step % 16;
    const phrase = Math.floor(state.bar / 8) % 2;
    const active = this.intensity * cfg.density;

    if (stepInBar === 0) state.bar += 1;

    if (state.mood === 'night') {
      this.scheduleNightGroove(state, time, stepInBar, active, phrase);
    } else if (state.mood === 'boss') {
      this.scheduleBossGroove(state, time, stepInBar, active);
    } else if (state.mood === 'launch') {
      this.scheduleLaunchGroove(state, time, stepInBar, active);
    } else {
      this.scheduleAmbientPulse(state, time, stepInBar, active);
    }

    if (state.mood === 'dusk' && stepInBar % 4 === 3 && active > 0.12) {
      this.tick(state.root, time, 0.035 + active * 0.03);
    }

    if (state.mood === 'gameover' && stepInBar === 0 && state.bar % 2 === 0) {
      this.bell(state.root, time, cfg.key + 12 - state.bar, 0.05, 2.8, false);
    }

    state.step += 1;
    state.nextStep += stepLength;
  }

  private scheduleAmbientPulse(state: MoodState, time: number, stepInBar: number, active: number): void {
    const cfg = MOODS[state.mood];
    const stepLength = (60 / cfg.bpm) / 4;

    if (stepInBar === 0 || (active > 0.6 && stepInBar % 8 === 0)) {
      this.subPulse(state.root, time, cfg.key - 12, 0.08 + active * 0.04, stepLength * 3.2);
    }

    if (active > 0.45 && stepInBar % 4 === 2) {
      this.hat(state.root, time, 0.025 + active * 0.035);
    }

    if ((state.mood === 'explore' || state.mood === 'title' || state.mood === 'victory') && Math.random() < cfg.density * 0.08) {
      this.bell(state.root, time, cfg.key + 12 + choose(cfg.scale), 0.045, 1.6, true);
    }
  }

  private scheduleNightGroove(state: MoodState, time: number, stepInBar: number, active: number, phrase: number): void {
    const cfg = MOODS.night;
    const pattern = phrase === 0 ? [0, 0, 3, 0, 5, 0, 3, -2] : [0, 3, 5, 7, 5, 3, 1, -2];
    const note = cfg.key - 12 + pattern[Math.floor(stepInBar / 2) % pattern.length];

    if (stepInBar % 2 === 0) this.subPulse(state.root, time, note, 0.1 + active * 0.06, 0.24);
    if (stepInBar === 0 || stepInBar === 8 || (active > 0.7 && stepInBar === 12)) this.taiko(state.root, time, 0.18 + active * 0.1);
    if (active > 0.35 && stepInBar % 4 === 2) this.taiko(state.root, time, 0.1 + active * 0.06, 92);
    if (active > 0.25 && stepInBar % 2 === 1) this.hat(state.root, time, 0.025 + active * 0.045);
  }

  private scheduleBossGroove(state: MoodState, time: number, stepInBar: number, active: number): void {
    const cfg = MOODS.boss;
    const ostinato = [0, 1, 0, 6, 0, 3, 1, -2];
    const note = cfg.key - 12 + ostinato[stepInBar % ostinato.length];

    this.subPulse(state.root, time, note, 0.09 + active * 0.06, 0.16);
    if (stepInBar % 4 === 0 || (active > 0.6 && stepInBar % 4 === 2)) this.taiko(state.root, time, 0.2 + active * 0.13, 58);
    if (stepInBar % 2 === 1) this.hat(state.root, time, 0.045 + active * 0.04);
    if (stepInBar === 4 || stepInBar === 12) this.brassStab(state.root, time, cfg.key + (stepInBar === 4 ? 6 : 1), 0.12 + active * 0.08);
  }

  private scheduleLaunchGroove(state: MoodState, time: number, stepInBar: number, active: number): void {
    const cfg = MOODS.launch;
    const rising = [0, 2, 4, 5, 7, 9, 11, 12];
    const note = cfg.key + 12 + rising[Math.floor((state.bar + stepInBar / 2) % rising.length)];

    if (stepInBar % 2 === 0) this.pluck(state.root, time, note, 0.06 + active * 0.03, 0.22, true);
    if (stepInBar === 0 || stepInBar === 8) this.taiko(state.root, time, 0.12 + active * 0.08, 64);
    if (active > 0.35 && stepInBar % 2 === 1) this.hat(state.root, time, 0.03 + active * 0.04);
    if (stepInBar === 12 && active > 0.5) this.brassStab(state.root, time, cfg.key + 7, 0.1);
  }

  private schedulePad(state: MoodState): void {
    const cfg = MOODS[state.mood];
    const chord = cfg.chords[state.bar % cfg.chords.length];
    const phrase = Math.floor(state.bar / 8) % 2;
    const octaveLift = state.mood === 'victory' ? 12 : 0;
    const duration = state.mood === 'boss' ? 4.2 : 8.4;
    const cutoff = state.mood === 'boss' ? 700 + this.intensity * 900 : 680 + cfg.density * 500;

    this.voiceLedPad(
      state.root,
      state.padNext,
      chord.map((note) => cfg.key + note + octaveLift + (phrase === 1 && state.mood === 'launch' ? 2 : 0)),
      duration,
      0.045 + cfg.density * 0.02,
      cutoff,
    );

    this.subDrone(state.root, state.padNext, cfg.key - 24 + chord[0], duration, 0.04 + cfg.density * 0.02);
    state.padNext += (state.mood === 'boss' ? 4 : 8) * (60 / cfg.bpm);
  }

  private scheduleTexture(state: MoodState): void {
    const cfg = MOODS[state.mood];
    const time = state.textureNext;

    if (state.mood !== 'victory') {
      scheduleNoiseHit(
        this.ctx,
        this.bank,
        state.root,
        time,
        rand(0.25, 0.7),
        0.018 + cfg.density * 0.025,
        'bandpass',
        rand(300, 2600),
        rand(2, 8),
      );
    }

    if (Math.random() < 0.55) {
      const note = cfg.key + 12 + choose(cfg.scale) + (Math.random() < 0.5 ? 12 : 0);
      this.bell(state.root, time + rand(0, 0.8), note, 0.025 + cfg.density * 0.02, rand(1.4, 3.5), true);
    }

    state.textureNext = time + rand(2.5, 6.5) / Math.max(0.5, cfg.density + 0.4);
  }

  private scheduleMotif(state: MoodState): void {
    const cfg = MOODS[state.mood];
    const time = state.motifNext;
    const slow = state.mood === 'title' || state.mood === 'gameover';
    const major = state.mood === 'victory' || state.mood === 'launch';
    const step = slow ? 0.9 : state.mood === 'boss' ? 0.22 : 0.42;
    const base = cfg.key + (state.mood === 'night' || state.mood === 'boss' ? -12 : 12);
    const gain = state.mood === 'boss' ? 0.055 : state.mood === 'victory' ? 0.07 : 0.045;

    KESSRA_MOTIF.forEach((degree, index) => {
      const resolved = major && degree === 3 ? 4 : degree;
      const note = base + resolved;
      if (state.mood === 'night' || state.mood === 'boss') {
        this.pluck(state.root, time + index * step, note, gain, 0.18, false, 'sawtooth');
      } else {
        this.bell(state.root, time + index * step, note, gain, slow ? 2.6 : 1.2, true);
      }
    });

    state.motifNext = time + (slow ? 16 : state.mood === 'boss' ? 6 : 10) * (60 / cfg.bpm);
  }

  private voiceLedPad(
    destination: AudioNode,
    time: number,
    notes: readonly number[],
    duration: number,
    gainValue: number,
    cutoff: number,
  ): void {
    notes.forEach((note, voiceIndex) => {
      const voiceGain = makeGain(this.ctx, 0);
      const filter = makeFilter(this.ctx, 'lowpass', cutoff + voiceIndex * 80, 0.8);
      const lfo = makeOsc(this.ctx, 'sine', rand(0.035, 0.08));
      const lfoDepth = makeGain(this.ctx, 110 + voiceIndex * 30);

      holdEnvelope(voiceGain.gain, time, gainValue / notes.length, 1.5, duration - 2.2, 1.3);
      lfo.connect(lfoDepth).connect(filter.frequency);
      filter.connect(voiceGain).connect(destination);
      lfo.start(time);
      safeStop(lfo, time + duration + 0.3);

      for (let detune = -1; detune <= 1; detune += 1) {
        const osc = makeOsc(this.ctx, 'sawtooth', midiToHz(note) * (1 + detune * 0.004));
        osc.detune.value = detune * 7 + rand(-1.5, 1.5);
        osc.connect(filter);
        osc.start(time);
        safeStop(osc, time + duration + 0.3);
      }
    });
  }

  private subDrone(destination: AudioNode, time: number, note: number, duration: number, gainValue: number): void {
    const osc = makeOsc(this.ctx, 'sine', midiToHz(note));
    const gain = makeGain(this.ctx, 0);
    holdEnvelope(gain.gain, time, gainValue, 1.2, duration - 1.6, 1.2);
    osc.connect(gain).connect(destination);
    osc.start(time);
    safeStop(osc, time + duration + 0.2);
  }

  private subPulse(destination: AudioNode, time: number, note: number, gainValue: number, duration: number): void {
    const osc = makeOsc(this.ctx, 'sawtooth', midiToHz(note));
    const filter = makeFilter(this.ctx, 'lowpass', 420 + this.intensity * 850, 0.9);
    const gain = makeGain(this.ctx, 0);
    envelope(gain.gain, time, gainValue, 0.012, duration);
    osc.connect(filter).connect(gain).connect(destination);
    osc.start(time);
    safeStop(osc, time + duration + 0.03);
  }

  private pluck(
    destination: AudioNode,
    time: number,
    note: number,
    gainValue: number,
    duration: number,
    delaySend: boolean,
    type: OscillatorType = 'triangle',
  ): void {
    const osc = makeOsc(this.ctx, type, midiToHz(note));
    const filter = makeFilter(this.ctx, 'lowpass', 1500 + this.intensity * 1200, 1.2);
    const gain = makeGain(this.ctx, 0);

    envelope(gain.gain, time, gainValue, 0.008, duration);
    osc.connect(filter).connect(gain).connect(destination);
    if (delaySend) gain.connect(this.delayInput);
    osc.start(time);
    safeStop(osc, time + duration + 0.03);
  }

  private bell(
    destination: AudioNode,
    time: number,
    note: number,
    gainValue: number,
    duration: number,
    delaySend: boolean,
  ): void {
    const fundamental = midiToHz(note);
    const gain = makeGain(this.ctx, 0);
    envelope(gain.gain, time, gainValue, 0.018, duration);
    gain.connect(destination);
    if (delaySend) gain.connect(this.delayInput);

    [1, 1.5, 2.01].forEach((ratio, index) => {
      const osc = makeOsc(this.ctx, 'sine', fundamental * ratio);
      const partialGain = makeGain(this.ctx, 1 / (index + 1.2));
      osc.connect(partialGain).connect(gain);
      osc.start(time + index * 0.012);
      safeStop(osc, time + duration + 0.05);
    });
  }

  private brassStab(destination: AudioNode, time: number, note: number, gainValue: number): void {
    const filter = makeFilter(this.ctx, 'bandpass', 620 + this.intensity * 900, 1.8);
    const shaper = this.ctx.createWaveShaper();
    shaper.curve = new Float32Array([-1, -0.45, 0, 0.45, 1]);
    const gain = makeGain(this.ctx, 0);

    envelope(gain.gain, time, gainValue, 0.02, 0.7);
    filter.connect(shaper).connect(gain).connect(destination);

    [0, 6, 10].forEach((offset, index) => {
      const osc = makeOsc(this.ctx, 'sawtooth', midiToHz(note + offset));
      osc.detune.value = (index - 1) * 8;
      osc.connect(filter);
      osc.start(time);
      safeStop(osc, time + 0.72);
    });
  }

  private taiko(destination: AudioNode, time: number, gainValue: number, high = 74): void {
    scheduleKick(this.ctx, destination, time, high, 32, 0.38, gainValue);
    scheduleNoiseHit(this.ctx, this.bank, destination, time + 0.01, 0.18, gainValue * 0.38, 'bandpass', 190, 1.2);
  }

  private hat(destination: AudioNode, time: number, gainValue: number): void {
    scheduleNoiseHit(this.ctx, this.bank, destination, time, 0.055, gainValue, 'highpass', 4600, 0.6, 'crackle');
  }

  private tick(destination: AudioNode, time: number, gainValue: number): void {
    scheduleTone(this.ctx, destination, time, 1800, 0.035, 'square', gainValue);
  }
}
