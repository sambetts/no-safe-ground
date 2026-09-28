import { audio } from '../audio/audio';
import type { Game } from '../game';

type Tone = 'info' | 'warn' | 'log' | 'bad' | 'good' | 'air';

interface Comm {
  el: HTMLDivElement;
  t: number;
  life: number;
}

/** Comms feed (ship AI + recovered logs), toasts and big centre-screen announcements. */
export class Messages {
  private commsEl: HTMLElement;
  private toasts: HTMLElement;
  private announceEl: HTMLElement;
  private list: Comm[] = [];
  private queue: { who: string; text: string; tone: Tone; tip?: string }[] = [];
  private gap = 0;
  private announceT = 0;

  constructor(game: Game) {
    const root = game.hud.root;
    this.commsEl = root.querySelector('#comms') as HTMLElement;
    this.toasts = root.querySelector('#toasts') as HTMLElement;
    this.announceEl = root.querySelector('#announce') as HTMLElement;
  }

  clear(): void {
    this.commsEl.innerHTML = '';
    this.toasts.innerHTML = '';
    this.list = [];
    this.queue = [];
    this.announceT = 0;
    this.announceEl.classList.remove('show');
  }

  comms_(who: string, text: string, tone: Tone, tip?: string): void {
    const d = document.createElement('div');
    d.className = `comm panel ${tone}`;
    d.innerHTML = `<div class="who">${who}</div><div class="msg"></div>${tip ? `<div class="tip">${tip}</div>` : ''}`;
    (d.querySelector('.msg') as HTMLElement).textContent = text;
    this.commsEl.appendChild(d);
    const life = 7 + text.length * 0.045 + (tip ? 3 : 0);
    this.list.push({ el: d, t: 0, life });
    while (this.list.length > 3) {
      const old = this.list.shift()!;
      old.el.remove();
    }
    audio.play(tone === 'log' ? 'logFound' : 'uiOpen', { volume: tone === 'log' ? 0.7 : 0.25, pitch: 1.3 });
  }

  /** Queue a comms message (spaced out so they don't pile up). */
  comms(who: string, text: string, tone: Tone = 'info', tip?: string): void {
    this.queue.push({ who, text, tone, tip });
  }

  toast(text: string, tone: Tone = 'info'): void {
    const d = document.createElement('div');
    d.className = `toast ${tone}`;
    d.textContent = text;
    this.toasts.appendChild(d);
    setTimeout(() => d.remove(), 2300);
    while (this.toasts.children.length > 4) this.toasts.firstElementChild?.remove();
  }

  announce(title: string, sub = '', tone: Tone = 'info', seconds = 3.2): void {
    (this.announceEl.querySelector('.t') as HTMLElement).textContent = title;
    (this.announceEl.querySelector('.s') as HTMLElement).textContent = sub;
    this.announceEl.className = `announce show ${tone}`;
    this.announceT = seconds;
  }

  update(dt: number): void {
    this.gap -= dt;
    if (this.queue.length && this.gap <= 0) {
      const m = this.queue.shift()!;
      this.comms_(m.who, m.text, m.tone, m.tip);
      this.gap = 2.2;
    }
    for (const c of this.list) {
      c.t += dt;
      if (c.t > c.life) c.el.classList.add('fade');
      if (c.t > c.life + 1) c.el.remove();
    }
    this.list = this.list.filter((c) => c.t <= c.life + 1);
    if (this.announceT > 0) {
      this.announceT -= dt;
      if (this.announceT <= 0) this.announceEl.classList.remove('show');
    }
  }
}

type HintId = 'move' | 'shoot' | 'dash' | 'mine' | 'secondary' | 'fabricator' | 'build' | 'bulb' | 'overheat' | 'night' | 'map';

const HINTS: Record<HintId, string> = {
  move: '<kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> move &nbsp;·&nbsp; <kbd>Mouse</kbd> aim',
  shoot: 'Hold <kbd>LMB</kbd> to fire your plasma blaster',
  dash: '<kbd>Space</kbd> dash — you are untouchable mid-dash',
  mine: 'Shoot glowing <b style="color:#46e8ff">xenite</b> crystals to harvest them',
  secondary: '<kbd>RMB</kbd> plasma grenade',
  fabricator: 'Stand on the ship ramp and press <kbd>E</kbd> to open the fabricator',
  build: 'Press <kbd>1</kbd>–<kbd>5</kbd> to build defences with scrap',
  bulb: 'Low on air — walk into a blue <b style="color:#5fd8ff">O₂ bulb</b> to refill',
  overheat: 'Blaster overheated — ease off the trigger to keep it cool',
  night: 'Night is coming — get back to the ship and its defences',
  map: '<kbd>M</kbd> opens the planetary map',
};

/** One contextual tutorial hint at a time, dismissed when the player performs the action. */
export class Hints {
  private el: HTMLElement;
  private doneSet = new Set<HintId>();
  private current: HintId | null = null;
  private t = 0;
  enabled = true;

  constructor(private game: Game) {
    this.el = game.hud.root.querySelector('#hint') as HTMLElement;
  }

  reset(): void {
    this.doneSet.clear();
    this.current = null;
    this.el.classList.remove('show');
  }

  done(id: HintId): void {
    this.doneSet.add(id);
    if (this.current === id) {
      this.current = null;
      this.el.classList.remove('show');
    }
  }

  show(id: HintId, seconds = 9): void {
    if (!this.enabled || this.doneSet.has(id) || this.current === id) return;
    if (this.current && this.t > 0) return;
    this.current = id;
    this.t = seconds;
    this.el.innerHTML = HINTS[id];
    this.el.classList.add('show');
  }

  update(dt: number): void {
    const g = this.game;
    if (this.current) {
      this.t -= dt;
      if (this.t <= 0) {
        if (this.current === 'overheat' || this.current === 'night' || this.current === 'map' || this.current === 'bulb') this.doneSet.add(this.current);
        this.current = null;
        this.el.classList.remove('show');
      }
      return;
    }
    if (g.state !== 'playing') return;
    const p = g.player;
    if (!this.doneSet.has('move')) return this.show('move', 12);
    if (!this.doneSet.has('shoot') && g.record.shots > 0) this.doneSet.add('shoot');
    if (!this.doneSet.has('shoot')) return this.show('shoot', 8);
    const nearX = g.resources.nearestNode(p.x, p.z, 12, 'xenite');
    if (nearX && !this.doneSet.has('mine')) return this.show('mine', 8);
    if (g.record.kills > 0 && !this.doneSet.has('dash')) return this.show('dash', 8);
    if (g.record.kills > 2 && !this.doneSet.has('secondary')) return this.show('secondary', 8);
    if (p.o2Frac < 0.45 && !p.inAir && !this.doneSet.has('bulb')) return this.show('bulb', 8);
    if (g.inventory.xenite >= 12 && !this.doneSet.has('fabricator') && g.nearHatch) return this.show('fabricator', 10);
    if (g.inventory.scrap >= 40 && !this.doneSet.has('build') && g.cycle.phase !== 'night') return this.show('build', 9);
    if ((g.cycle.phase === 'dusk' || g.cycle.timeToNight() < 40) && !this.doneSet.has('night')) return this.show('night', 7);
    if (g.playTime > 120 && !this.doneSet.has('map')) return this.show('map', 6);
  }

  markFabricatorUsed(): void {
    this.done('fabricator');
  }
}
