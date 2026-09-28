// Procedural audio engine for NO SAFE GROUND.
// Synthesises all SFX, loops, and adaptive music at runtime with the Web Audio API.

import {
  clamp,
  makeFilter,
  makeGain,
  makeImpulse,
  makeNoiseBank,
  makeOsc,
  noiseSource,
  type NoiseBank,
  rand,
  safeStop,
} from './dsp';
import { GenerativeMusic } from './music';
import { HEAVY_SFX, SfxSynth } from './sfx';

export type SfxName =
  | 'shoot'
  | 'shootSpread'
  | 'overheat'
  | 'cooled'
  | 'hit'
  | 'hitArmor'
  | 'enemyDie'
  | 'bigDie'
  | 'playerHurt'
  | 'dash'
  | 'pickupScrap'
  | 'pickupXenite'
  | 'pickupHealth'
  | 'bulbPop'
  | 'partPickup'
  | 'install'
  | 'build'
  | 'turretShoot'
  | 'teslaZap'
  | 'explosion'
  | 'grenadeThrow'
  | 'spit'
  | 'acidSplash'
  | 'roar'
  | 'charge'
  | 'burrow'
  | 'emerge'
  | 'sporeRelease'
  | 'thunder'
  | 'lightning'
  | 'geyser'
  | 'uiClick'
  | 'uiHover'
  | 'uiError'
  | 'uiOpen'
  | 'uiClose'
  | 'upgrade'
  | 'alarm'
  | 'nightfall'
  | 'dawn'
  | 'o2Warning'
  | 'heartbeat'
  | 'shipHit'
  | 'crash'
  | 'engineRoar'
  | 'logFound'
  | 'nestSpawn'
  | 'shieldBreak'
  | 'step'
  | 'bossRoar'
  | 'mineBeep'
  | 'victory'
  | 'defeat';

export type LoopName = 'wind' | 'breathing' | 'storm' | 'shipHum' | 'fire';

export type MusicMood =
  | 'silent'
  | 'title'
  | 'explore'
  | 'dusk'
  | 'night'
  | 'boss'
  | 'launch'
  | 'victory'
  | 'gameover';

export interface PlayOpts {
  /** 0..1 (can exceed 1 slightly for emphasis). Default 1. */
  volume?: number;
  /** Playback-rate / pitch multiplier. Default 1. */
  pitch?: number;
  /** World position (XZ plane) for distance attenuation + stereo pan. Omit for non-positional (UI) sounds. */
  x?: number;
  z?: number;
}

export interface LoopHandle {
  setVolume(v: number): void;
  stop(): void;
}

type AudioContextCtor = new (options?: AudioContextOptions) => AudioContext;

type Voice = {
  name: SfxName;
  gain: GainNode;
  nodes: AudioNode[];
  stopAt: number;
};

type LoopGraph = {
  output: GainNode;
  nodes: AudioNode[];
  sources: AudioScheduledSourceNode[];
  stopped: boolean;
};

const DEFAULT_MASTER = 0.8;
const DEFAULT_SFX = 0.9;
const DEFAULT_MUSIC = 0.6;
const GLOBAL_VOICE_CAP = 64;
const NEAR_DISTANCE = 8;
const FAR_DISTANCE = 48;

const SFX_NAMES: readonly SfxName[] = [
  'shoot',
  'shootSpread',
  'overheat',
  'cooled',
  'hit',
  'hitArmor',
  'enemyDie',
  'bigDie',
  'playerHurt',
  'dash',
  'pickupScrap',
  'pickupXenite',
  'pickupHealth',
  'bulbPop',
  'partPickup',
  'install',
  'build',
  'turretShoot',
  'teslaZap',
  'explosion',
  'grenadeThrow',
  'spit',
  'acidSplash',
  'roar',
  'charge',
  'burrow',
  'emerge',
  'sporeRelease',
  'thunder',
  'lightning',
  'geyser',
  'uiClick',
  'uiHover',
  'uiError',
  'uiOpen',
  'uiClose',
  'upgrade',
  'alarm',
  'nightfall',
  'dawn',
  'o2Warning',
  'heartbeat',
  'shipHit',
  'crash',
  'engineRoar',
  'logFound',
  'nestSpawn',
  'shieldBreak',
  'step',
  'bossRoar',
  'mineBeep',
  'victory',
  'defeat',
];

const HEAVY_SET = new Set<SfxName>(HEAVY_SFX);

const SFX_POLICY: Record<SfxName, { max: number; minMs: number }> = Object.fromEntries(
  SFX_NAMES.map((name) => [name, { max: HEAVY_SET.has(name) ? 2 : 6, minMs: HEAVY_SET.has(name) ? 90 : 30 }]),
) as Record<SfxName, { max: number; minMs: number }>;

Object.assign(SFX_POLICY, {
  hit: { max: 8, minMs: 24 },
  shoot: { max: 7, minMs: 28 },
  shootSpread: { max: 5, minMs: 40 },
  turretShoot: { max: 8, minMs: 25 },
  enemyDie: { max: 6, minMs: 35 },
  pickupXenite: { max: 7, minMs: 28 },
  step: { max: 4, minMs: 55 },
  teslaZap: { max: 5, minMs: 45 },
} satisfies Partial<Record<SfxName, { max: number; minMs: number }>>);

class DeferredLoop implements LoopHandle {
  private graph?: LoopGraph;
  private stopped = false;
  private targetVolume = 0;

  constructor(
    private readonly engine: AudioEngine,
    readonly name: LoopName,
  ) {}

  setVolume(v: number): void {
    this.targetVolume = clamp(v, 0, 1.5);
    if (this.graph) this.engine.fadeParam(this.graph.output.gain, this.targetVolume, 0.4);
  }

  stop(): void {
    this.stopped = true;
    if (this.graph) this.engine.releaseLoop(this.graph);
    this.graph = undefined;
  }

  activate(): void {
    if (this.stopped || this.graph || !this.engine.ready) return;

    this.graph = this.engine.createLoopGraph(this.name);
    if (this.graph) this.engine.fadeParam(this.graph.output.gain, this.targetVolume, 0.45);
  }
}

export class AudioEngine {
  private ctx?: AudioContext;
  private noiseBank?: NoiseBank;
  private masterGain?: GainNode;
  private sfxGain?: GainNode;
  private musicGain?: GainNode;
  private sfxDuck?: GainNode;
  private musicDuck?: GainNode;
  private masterFilter?: BiquadFilterNode;
  private sfxSynth?: SfxSynth;
  private musicSystem?: GenerativeMusic;

  private masterVolume = DEFAULT_MASTER;
  private sfxVolume = DEFAULT_SFX;
  private musicVolume = DEFAULT_MUSIC;
  private paused = false;
  private hidden = false;
  private muffled = 0;
  private requestedMood: MusicMood = 'silent';
  private requestedIntensity = 0;
  private listenerX = 0;
  private listenerZ = 0;

  private readonly voices: Voice[] = [];
  private readonly voicesByName = new Map<SfxName, Voice[]>();
  private readonly lastPlayByName = new Map<SfxName, number>();
  private readonly loopHandles: DeferredLoop[] = [];

  constructor() {
    try {
      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', () => {
          this.hidden = document.hidden;
          this.applyDucks();
          if (!document.hidden) void this.ctx?.resume().catch(() => undefined);
        });
      }
    } catch {
      // Headless/non-browser environments are supported as silent no-ops.
    }
  }

  get ready(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  unlock(): void {
    try {
      if (!this.ctx) this.createContext();
      if (!this.ctx) return;

      if (this.ctx.state !== 'running') void this.ctx.resume().catch(() => undefined);

      this.applyVolumes(true);
      this.applyDucks();
      this.applyMuffle(true);
      this.sfxSynth?.startPrerender();
      this.musicSystem?.setIntensity(this.requestedIntensity);
      this.musicSystem?.setMood(this.requestedMood);

      for (const handle of this.loopHandles) handle.activate();
    } catch {
      // Public methods must never throw.
    }
  }

  setVolumes(v: { master?: number; sfx?: number; music?: number }): void {
    try {
      if (typeof v.master === 'number') this.masterVolume = clamp(v.master);
      if (typeof v.sfx === 'number') this.sfxVolume = clamp(v.sfx);
      if (typeof v.music === 'number') this.musicVolume = clamp(v.music);
      this.applyVolumes(false);
    } catch {}
  }

  setListener(x: number, z: number): void {
    if (Number.isFinite(x)) this.listenerX = x;
    if (Number.isFinite(z)) this.listenerZ = z;
  }

  play(name: SfxName, opts?: PlayOpts): void {
    try {
      const ctx = this.ctx;
      if (!ctx || !this.sfxSynth) return;
      if (ctx.state !== 'running') void ctx.resume().catch(() => undefined);

      const now = ctx.currentTime;
      const policy = SFX_POLICY[name];
      const previous = this.lastPlayByName.get(name) ?? -99;
      if ((now - previous) * 1000 < policy.minMs) return;

      const spatial = this.computeSpatial(opts);
      if (spatial.skip) return;

      this.lastPlayByName.set(name, now);
      this.enforceVoiceLimits(name, policy.max);

      const voiceGain = ctx.createGain();
      const distanceFilter = ctx.createBiquadFilter();
      const panner = ctx.createStereoPanner();

      voiceGain.gain.value = 0.0001;
      distanceFilter.type = 'lowpass';
      distanceFilter.frequency.value = spatial.lowpass;
      distanceFilter.Q.value = 0.1;
      panner.pan.value = spatial.pan;

      voiceGain.connect(distanceFilter).connect(panner).connect(this.sfxGain ?? ctx.destination);

      const requestedVolume = clamp(opts?.volume ?? 1, 0, 2.5);
      const pitch = clamp(opts?.pitch ?? 1, 0.2, 4) * rand(0.94, 1.06);
      const voiceVolume = requestedVolume * spatial.gain;
      voiceGain.gain.linearRampToValueAtTime(Math.max(0.0001, voiceVolume), now + 0.006);

      const renderedVoice = this.sfxSynth.play(name, voiceGain, now, pitch, voiceVolume);
      voiceGain.gain.setTargetAtTime(0.0001, now + renderedVoice.duration, 0.04);

      const voice: Voice = {
        name,
        gain: voiceGain,
        nodes: [voiceGain, distanceFilter, panner, ...renderedVoice.extraNodes],
        stopAt: now + renderedVoice.duration + 0.25,
      };

      this.registerVoice(voice);
      window.setTimeout(() => this.cleanupVoice(voice), Math.max(100, (renderedVoice.duration + 0.4) * 1000));
    } catch {
      // SFX should fail silently rather than interrupt gameplay.
    }
  }

  loop(name: LoopName): LoopHandle {
    try {
      const handle = new DeferredLoop(this, name);
      this.loopHandles.push(handle);
      handle.activate();
      return handle;
    } catch {
      return { setVolume() {}, stop() {} };
    }
  }

  setMusic(mood: MusicMood): void {
    try {
      if (this.requestedMood === mood) return;
      this.requestedMood = mood;
      this.musicSystem?.setMood(mood);
    } catch {}
  }

  setIntensity(v: number): void {
    this.requestedIntensity = clamp(v);
    this.musicSystem?.setIntensity(this.requestedIntensity);
  }

  setPaused(p: boolean): void {
    this.paused = p;
    this.applyDucks();
  }

  setMuffled(amount: number): void {
    this.muffled = clamp(amount);
    this.applyMuffle(false);
  }

  update(dt: number): void {
    try {
      this.musicSystem?.update(dt);
    } catch {}
  }

  /** Internal loop fade helper used by DeferredLoop handles. */
  fadeParam(param: AudioParam, value: number, seconds: number): void {
    const ctx = this.ctx;
    if (!ctx) return;

    param.cancelScheduledValues(ctx.currentTime);
    param.setTargetAtTime(Math.max(0.0001, value), ctx.currentTime, Math.max(0.02, seconds / 3));
  }

  /** Release loop nodes after a short fade-out. */
  releaseLoop(graph: LoopGraph): void {
    if (graph.stopped || !this.ctx) return;

    graph.stopped = true;
    this.fadeParam(graph.output.gain, 0.0001, 0.3);

    for (const source of graph.sources) safeStop(source, this.ctx.currentTime + 0.55);

    window.setTimeout(() => {
      for (const node of graph.nodes) {
        try {
          node.disconnect();
        } catch {
          // Node may already be disconnected.
        }
      }
    }, 900);
  }

  /** Build one of the five continuous ambient loop graphs. */
  createLoopGraph(name: LoopName): LoopGraph | undefined {
    try {
      const ctx = this.ctx;
      const bank = this.noiseBank;
      if (!ctx || !bank) return undefined;

      const output = makeGain(ctx, 0.0001);
      output.connect(this.sfxGain ?? ctx.destination);

      const graph: LoopGraph = {
        output,
        nodes: [output],
        sources: [],
        stopped: false,
      };

      if (name === 'shipHum') this.createShipHum(graph);
      else if (name === 'breathing') this.createBreathingLoop(graph);
      else if (name === 'wind') this.createWindLoop(graph);
      else if (name === 'storm') this.createStormLoop(graph);
      else this.createFireLoop(graph);

      return graph;
    } catch {
      return undefined;
    }
  }

  private createContext(): void {
    const maybeWindow = typeof window !== 'undefined' ? window : undefined;
    if (!maybeWindow) return;

    const ctor = maybeWindow.AudioContext
      ?? (maybeWindow as Window & { webkitAudioContext?: AudioContextCtor }).webkitAudioContext;
    if (!ctor) return;

    const ctx = new ctor({ latencyHint: 'interactive' });
    const noiseBank = makeNoiseBank(ctx);
    const masterGain = makeGain(ctx, this.masterVolume);
    const sfxGain = makeGain(ctx, this.sfxVolume);
    const musicGain = makeGain(ctx, this.musicVolume);
    const sfxDuck = makeGain(ctx, 1);
    const musicDuck = makeGain(ctx, 1);
    const masterFilter = makeFilter(ctx, 'lowpass', 20000, 0.2);
    const compressor = ctx.createDynamicsCompressor();
    const convolver = ctx.createConvolver();
    const reverbSend = makeGain(ctx, 0.25);
    const reverbReturn = makeGain(ctx, 0.18);

    compressor.threshold.value = -15;
    compressor.knee.value = 18;
    compressor.ratio.value = 7;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.16;
    convolver.buffer = makeImpulse(ctx, 2.8);

    sfxGain.connect(sfxDuck).connect(masterGain);
    musicGain.connect(musicDuck).connect(masterGain);
    sfxGain.connect(reverbSend);
    musicGain.connect(reverbSend);
    reverbSend.connect(convolver).connect(reverbReturn).connect(masterGain);
    masterGain.connect(masterFilter).connect(compressor).connect(ctx.destination);

    this.ctx = ctx;
    this.noiseBank = noiseBank;
    this.masterGain = masterGain;
    this.sfxGain = sfxGain;
    this.musicGain = musicGain;
    this.sfxDuck = sfxDuck;
    this.musicDuck = musicDuck;
    this.masterFilter = masterFilter;
    this.sfxSynth = new SfxSynth(ctx, noiseBank);
    this.musicSystem = new GenerativeMusic(ctx, musicGain, noiseBank, reverbSend);
  }

  private applyVolumes(immediate: boolean): void {
    const ctx = this.ctx;
    if (!ctx) return;

    const timeConstant = immediate ? 0.001 : 0.08;
    this.masterGain?.gain.setTargetAtTime(this.masterVolume, ctx.currentTime, timeConstant);
    this.sfxGain?.gain.setTargetAtTime(this.sfxVolume, ctx.currentTime, timeConstant);
    this.musicGain?.gain.setTargetAtTime(this.musicVolume, ctx.currentTime, timeConstant);
  }

  private applyDucks(): void {
    const ctx = this.ctx;
    if (!ctx) return;

    const sfxDuck = this.paused ? 0.25 : this.hidden ? 0.45 : 1;
    const musicDuck = this.paused ? 0.42 : this.hidden ? 0.55 : 1;

    this.sfxDuck?.gain.setTargetAtTime(sfxDuck, ctx.currentTime, 0.08);
    this.musicDuck?.gain.setTargetAtTime(musicDuck, ctx.currentTime, 0.16);
    this.applyMuffle(false);
  }

  private applyMuffle(immediate: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !this.masterFilter) return;

    const amount = clamp(this.muffled + (this.paused ? 0.25 : 0));
    const frequency = 20000 * (1 - amount) + 500 * amount;
    this.masterFilter.frequency.setTargetAtTime(frequency, ctx.currentTime, immediate ? 0.005 : 0.12);
  }

  private computeSpatial(opts?: PlayOpts): { gain: number; pan: number; lowpass: number; skip: boolean } {
    if (
      typeof opts?.x !== 'number'
      || typeof opts.z !== 'number'
      || !Number.isFinite(opts.x)
      || !Number.isFinite(opts.z)
    ) {
      return { gain: 1, pan: 0, lowpass: 20000, skip: false };
    }

    const dx = opts.x - this.listenerX;
    const dz = opts.z - this.listenerZ;
    const distance = Math.hypot(dx, dz);
    if (distance > FAR_DISTANCE) return { gain: 0, pan: 0, lowpass: 1000, skip: true };

    const falloff = clamp((distance - NEAR_DISTANCE) / (FAR_DISTANCE - NEAR_DISTANCE));
    const smooth = falloff * falloff * (3 - 2 * falloff);

    return {
      gain: 1 - smooth,
      pan: clamp(dx / 28, -1, 1),
      lowpass: 18000 - 8500 * falloff,
      skip: false,
    };
  }

  private enforceVoiceLimits(name: SfxName, maxForName: number): void {
    const now = this.ctx?.currentTime ?? 0;

    for (let i = this.voices.length - 1; i >= 0; i -= 1) {
      if (this.voices[i]?.stopAt <= now) this.voices.splice(i, 1);
    }

    const named = (this.voicesByName.get(name) ?? []).filter((voice) => voice.stopAt > now);
    this.voicesByName.set(name, named);

    while (named.length >= maxForName) this.killVoice(named.shift());
    while (this.voices.length >= GLOBAL_VOICE_CAP) this.killVoice(this.voices.shift());
  }

  private registerVoice(voice: Voice): void {
    this.voices.push(voice);

    const named = this.voicesByName.get(voice.name) ?? [];
    named.push(voice);
    this.voicesByName.set(voice.name, named);
  }

  private killVoice(voice?: Voice): void {
    const ctx = this.ctx;
    if (!voice || !ctx) return;

    voice.gain.gain.cancelScheduledValues(ctx.currentTime);
    voice.gain.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.015);
    window.setTimeout(() => this.cleanupVoice(voice), 90);
  }

  private cleanupVoice(voice: Voice): void {
    for (const node of voice.nodes) {
      try {
        node.disconnect();
      } catch {
        // Already disconnected.
      }
    }

    const voiceIndex = this.voices.indexOf(voice);
    if (voiceIndex >= 0) this.voices.splice(voiceIndex, 1);

    const named = this.voicesByName.get(voice.name);
    if (named) this.voicesByName.set(voice.name, named.filter((entry) => entry !== voice));
  }

  private startLoopSource(graph: LoopGraph, source: AudioScheduledSourceNode): void {
    const ctx = this.ctx;
    if (!ctx) return;

    source.start(ctx.currentTime);
    graph.sources.push(source);
    graph.nodes.push(source);
  }

  private createWindLoop(graph: LoopGraph): void {
    const ctx = this.ctx;
    const bank = this.noiseBank;
    if (!ctx || !bank) return;

    const source = noiseSource(ctx, bank, 'white', true);
    const filter = makeFilter(ctx, 'bandpass', 520, 0.7);
    const lfo = makeOsc(ctx, 'sine', 0.045);
    const lfoDepth = makeGain(ctx, 260);

    lfo.connect(lfoDepth).connect(filter.frequency);
    source.connect(filter).connect(graph.output);
    this.startLoopSource(graph, source);
    this.startLoopSource(graph, lfo);
    graph.nodes.push(filter, lfoDepth);
  }

  private createBreathingLoop(graph: LoopGraph): void {
    const ctx = this.ctx;
    const bank = this.noiseBank;
    if (!ctx || !bank) return;

    const source = noiseSource(ctx, bank, 'white', true);
    const filter = makeFilter(ctx, 'lowpass', 850, 0.5);
    const amp = makeGain(ctx, 0.13);
    const lfo = makeOsc(ctx, 'sine', 0.31);
    const lfoDepth = makeGain(ctx, 0.08);

    lfo.connect(lfoDepth).connect(amp.gain);
    source.connect(filter).connect(amp).connect(graph.output);
    this.startLoopSource(graph, source);
    this.startLoopSource(graph, lfo);
    graph.nodes.push(filter, amp, lfoDepth);
  }

  private createStormLoop(graph: LoopGraph): void {
    const ctx = this.ctx;
    const bank = this.noiseBank;
    if (!ctx || !bank) return;

    const rain = noiseSource(ctx, bank, 'white', true);
    const rumble = noiseSource(ctx, bank, 'white', true);
    const crackle = noiseSource(ctx, bank, 'crackle', true);
    const rainFilter = makeFilter(ctx, 'highpass', 1700, 0.3);
    const rumbleFilter = makeFilter(ctx, 'lowpass', 110, 0.8);
    const crackleFilter = makeFilter(ctx, 'highpass', 2800, 0.8);
    const rainGain = makeGain(ctx, 0.18);
    const rumbleGain = makeGain(ctx, 0.08);
    const crackleGain = makeGain(ctx, 0.035);

    rain.connect(rainFilter).connect(rainGain).connect(graph.output);
    rumble.connect(rumbleFilter).connect(rumbleGain).connect(graph.output);
    crackle.connect(crackleFilter).connect(crackleGain).connect(graph.output);
    this.startLoopSource(graph, rain);
    this.startLoopSource(graph, rumble);
    this.startLoopSource(graph, crackle);
    graph.nodes.push(rainFilter, rumbleFilter, crackleFilter, rainGain, rumbleGain, crackleGain);
  }

  private createShipHum(graph: LoopGraph): void {
    const ctx = this.ctx;
    if (!ctx) return;

    const hum = makeOsc(ctx, 'sawtooth', 48);
    const sub = makeOsc(ctx, 'sine', 24);
    const filter = makeFilter(ctx, 'lowpass', 180, 0.9);
    const amp = makeGain(ctx, 0.16);
    const lfo = makeOsc(ctx, 'sine', 0.8);
    const lfoDepth = makeGain(ctx, 0.035);

    lfo.connect(lfoDepth).connect(amp.gain);
    hum.connect(filter);
    sub.connect(filter);
    filter.connect(amp).connect(graph.output);
    this.startLoopSource(graph, hum);
    this.startLoopSource(graph, sub);
    this.startLoopSource(graph, lfo);
    graph.nodes.push(filter, amp, lfoDepth);
  }

  private createFireLoop(graph: LoopGraph): void {
    const ctx = this.ctx;
    const bank = this.noiseBank;
    if (!ctx || !bank) return;

    const bed = noiseSource(ctx, bank, 'white', true);
    const pops = noiseSource(ctx, bank, 'crackle', true);
    const bedFilter = makeFilter(ctx, 'lowpass', 900, 0.7);
    const popFilter = makeFilter(ctx, 'bandpass', 2300 + rand(-200, 200), 3);
    const bedGain = makeGain(ctx, 0.08);
    const popGain = makeGain(ctx, 0.08);

    bed.connect(bedFilter).connect(bedGain).connect(graph.output);
    pops.connect(popFilter).connect(popGain).connect(graph.output);
    this.startLoopSource(graph, bed);
    this.startLoopSource(graph, pops);
    graph.nodes.push(bedFilter, popFilter, bedGain, popGain);
  }
}

export const audio = new AudioEngine();

