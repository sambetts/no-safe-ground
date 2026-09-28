import { DIFFICULTIES, DifficultyId } from '../config';
import { formatTime } from '../core/math';
import { audio } from '../audio/audio';
import { SECONDARIES, SecondaryId, UPGRADES } from '../systems/upgrades';
import type { Quality } from '../render/renderer';
import type { Game } from '../game';

export interface Settings {
  master: number;
  music: number;
  sfx: number;
  quality: Quality;
  shake: boolean;
  damageNumbers: boolean;
  hints: boolean;
  difficulty: DifficultyId;
}

const KEY = 'nsg-settings-v1';
const BEST = 'nsg-best-v1';

export const loadSettings = (): Settings => {
  const def: Settings = { master: 0.8, music: 0.6, sfx: 0.9, quality: 'high', shake: true, damageNumbers: true, hints: true, difficulty: 'survivor' };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...def, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    /* ignore */
  }
  return def;
};

export const saveSettings = (s: Settings): void => {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
};

export interface BestRecord {
  time: number;
  difficulty: DifficultyId;
  kills: number;
}

export const loadBest = (): Record<string, BestRecord> => {
  try {
    return JSON.parse(localStorage.getItem(BEST) ?? '{}') as Record<string, BestRecord>;
  } catch {
    return {};
  }
};

export const saveBest = (rec: BestRecord): boolean => {
  const all = loadBest();
  const cur = all[rec.difficulty];
  if (!cur || rec.time < cur.time) {
    all[rec.difficulty] = rec;
    try {
      localStorage.setItem(BEST, JSON.stringify(all));
    } catch {
      /* ignore */
    }
    return true;
  }
  return false;
};

const CONTROLS = `
  <div><span>Move</span><span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd></span></div>
  <div><span>Aim / fire</span><span><kbd>Mouse</kbd> <kbd>LMB</kbd></span></div>
  <div><span>Secondary weapon</span><span><kbd>RMB</kbd></span></div>
  <div><span>Dash (invulnerable)</span><span><kbd>Space</kbd> / <kbd>Shift</kbd></span></div>
  <div><span>Fabricator (at ship ramp)</span><span><kbd>E</kbd></span></div>
  <div><span>Build defences</span><span><kbd>1</kbd>–<kbd>5</kbd></span></div>
  <div><span>Cancel build</span><span><kbd>Q</kbd> / <kbd>RMB</kbd></span></div>
  <div><span>Planetary map</span><span><kbd>M</kbd> / <kbd>Tab</kbd></span></div>
  <div><span>Zoom</span><span><kbd>Wheel</kbd></span></div>
  <div><span>Pause</span><span><kbd>Esc</kbd></span></div>`;

/** Menus and modal screens. */
export class Screens {
  private title: HTMLElement;
  private pause: HTMLElement;
  private fab: HTMLElement;
  private map: HTMLElement;
  private settingsEl: HTMLElement;
  private help: HTMLElement;
  private end: HTMLElement;
  private skip: HTMLElement;
  private subtitle: HTMLElement;
  private mapCanvas: HTMLCanvasElement;
  settings: Settings;
  private settingsReturn: () => void = () => {};

  constructor(private game: Game) {
    this.settings = loadSettings();
    const mk = (id: string, cls: string, html: string) => {
      const d = document.createElement('div');
      d.id = id;
      d.className = cls;
      d.innerHTML = html;
      document.body.appendChild(d);
      return d;
    };
    this.title = mk(
      'title',
      'screen',
      `<div class="logo">
         <div class="pre">SURVEY VESSEL KITTIWAKE · EMERGENCY LANDING</div>
         <h1>NO SAFE GROUND</h1>
         <div class="tag">You crashed on Kessra. Repair the ship. Survive the nights.</div>
       </div>
       <div class="title-menu">
         <div class="difficulty" id="diffs"></div>
         <button class="btn primary" id="btn-start">Begin</button>
         <div class="row" style="margin-top:4px">
           <button class="btn" id="btn-help">How to play</button>
           <button class="btn" id="btn-settings">Settings</button>
         </div>
         <div class="best" id="best"></div>
       </div>
       <div class="title-foot">Headphones recommended · WASD + mouse or gamepad</div>`,
    );
    this.pause = mk(
      'pause',
      'screen dim',
      `<div class="card">
         <h2>Paused</h2>
         <div class="sub" id="pause-sub"></div>
         <div class="controls">${CONTROLS}</div>
         <div class="row">
           <button class="btn primary" id="btn-resume">Resume</button>
           <button class="btn" id="btn-psettings">Settings</button>
           <button class="btn" id="btn-restart">Restart</button>
           <button class="btn" id="btn-quit">Abandon run</button>
         </div>
       </div>`,
    );
    this.fab = mk('fab', 'screen dim', `<div class="card" id="fab-card"></div>`);
    this.map = mk('map', 'screen dim', `<canvas width="900" height="900"></canvas><div class="map-legend">◆ ship components &nbsp; ● ship &nbsp; ■ wrecks &nbsp; <span style="color:#ff3355">●</span> nests &nbsp; <span style="color:#5fd8ff">●</span> O₂ bulbs &nbsp; · &nbsp; <kbd>M</kbd> close</div>`);
    this.mapCanvas = this.map.querySelector('canvas') as HTMLCanvasElement;
    this.settingsEl = mk('settings', 'screen dim', `<div class="card" style="width:min(560px,92vw)" id="settings-card"></div>`);
    this.help = mk(
      'help',
      'screen dim',
      `<div class="card">
        <h2>Field manual</h2>
        <div class="sub">Survey Vessel Kittiwake — crash protocol</div>
        <div style="font-size:14px;line-height:1.65;color:#cfd8e3">
          <p>Your ship went down on <b>Kessra</b>. Four components were torn loose in the descent — a <b style="color:#7dff5a">Thruster Coil</b>, a <b style="color:#5ef2ff">Fuel Cell</b>, a <b style="color:#ffb347">Navigation Core</b> and the <b style="color:#ff3a5c">Reactor Core</b>. Their signals are on your HUD. Carry each one back to the ship.</p>
          <p><b>Air.</b> Kessra's atmosphere will kill you. Your tank refills inside the ship's field and near O₂ beacons you build. Blue <b style="color:#5fd8ff">bulb plants</b> burst with oxygen when you walk into them.</p>
          <p><b>Day and night.</b> By day the creatures are scattered. At night they swarm the ship. Build turrets, barricades and flood lamps with <b>scrap</b>; buy upgrades at the fabricator with glowing <b style="color:#46e8ff">xenite</b>. Every night is worse than the last.</p>
          <p><b>Combat.</b> Your blaster overheats — watch the ring around the crosshair. Dash through danger: you cannot be hurt mid-dash. Read the ground: glowing marks mean something is about to land there.</p>
        </div>
        <div class="controls">${CONTROLS}</div>
        <div class="row"><button class="btn primary" id="btn-help-close">Got it</button></div>
      </div>`,
    );
    this.end = mk('end', 'screen dim', `<div class="card" id="end-card"></div>`);
    this.skip = mk('skip', 'skip', 'Press <kbd>Space</kbd> to skip');
    this.subtitle = mk('subtitle', 'subtitle', '');

    const byId = (id: string) => document.getElementById(id) as HTMLElement;
    const click = (id: string, fn: () => void) =>
      byId(id).addEventListener('click', () => {
        audio.unlock();
        audio.play('uiClick');
        fn();
      });
    click('btn-start', () => this.game.startRun(this.settings.difficulty));
    click('btn-help', () => this.showHelp(true));
    click('btn-help-close', () => this.showHelp(false));
    click('btn-settings', () => this.openSettings(() => this.showTitle(true)));
    click('btn-resume', () => this.game.setPaused(false));
    click('btn-psettings', () => this.openSettings(() => this.showPause(true)));
    click('btn-restart', () => this.game.startRun(this.game.difficulty.id));
    click('btn-quit', () => this.game.toTitle());
    for (const b of document.querySelectorAll('.btn')) b.addEventListener('mouseenter', () => audio.play('uiHover', { volume: 0.5 }));
    this.renderDifficulty();
  }

  private renderDifficulty(): void {
    const box = document.getElementById('diffs')!;
    box.innerHTML = '';
    for (const d of Object.values(DIFFICULTIES)) {
      const el = document.createElement('div');
      el.className = `diff${d.id === this.settings.difficulty ? ' sel' : ''}`;
      el.innerHTML = `<div class="n">${d.name}</div><div class="b">${d.blurb}</div>`;
      el.addEventListener('click', () => {
        audio.unlock();
        audio.play('uiClick');
        this.settings.difficulty = d.id;
        saveSettings(this.settings);
        this.renderDifficulty();
      });
      box.appendChild(el);
    }
    const best = loadBest();
    const lines = Object.values(best).map((b) => `${DIFFICULTIES[b.difficulty].name}: escaped in ${formatTime(b.time)}`);
    document.getElementById('best')!.textContent = lines.length ? `Best — ${lines.join(' · ')}` : '';
  }

  hideAll(): void {
    for (const el of [this.title, this.pause, this.fab, this.map, this.settingsEl, this.help, this.end]) el.classList.remove('show');
    document.body.classList.remove('menu-open');
  }

  private menu(el: HTMLElement, v: boolean): void {
    el.classList.toggle('show', v);
    const any = [this.title, this.pause, this.fab, this.settingsEl, this.help, this.end].some((e) => e.classList.contains('show'));
    document.body.classList.toggle('menu-open', any);
  }

  showTitle(v: boolean): void {
    if (v) this.renderDifficulty();
    this.menu(this.title, v);
  }

  showHelp(v: boolean): void {
    this.menu(this.help, v);
    if (v) this.menu(this.title, false);
    else if (this.game.state === 'title') this.menu(this.title, true);
  }

  showPause(v: boolean): void {
    if (v) {
      const g = this.game;
      (document.getElementById('pause-sub') as HTMLElement).textContent = `${g.difficulty.name} · Day ${g.cycle.day} · ${formatTime(g.playTime)} elapsed · world seed ${g.seed}`;
    }
    this.menu(this.pause, v);
  }

  get mapOpen(): boolean {
    return this.map.classList.contains('show');
  }

  toggleMap(v?: boolean): void {
    const show = v ?? !this.mapOpen;
    this.map.classList.toggle('show', show);
    if (show) this.drawMap();
  }

  drawMap(): void {
    const ctx = this.mapCanvas.getContext('2d')!;
    this.game.hud.drawMap(ctx, 900, 0, 0, 192, true);
  }

  showSkip(v: boolean): void {
    this.skip.classList.toggle('show', v);
  }

  setSubtitle(text: string | null): void {
    if (text === null) {
      this.subtitle.classList.remove('show');
      return;
    }
    this.subtitle.textContent = text;
    this.subtitle.classList.add('show');
  }

  openSettings(onClose: () => void): void {
    this.settingsReturn = onClose;
    this.menu(this.pause, false);
    this.menu(this.title, false);
    const s = this.settings;
    const card = document.getElementById('settings-card')!;
    card.innerHTML = `
      <h2>Settings</h2>
      <div class="sub">Saved automatically</div>
      <div class="setting"><span>Master volume</span><input type="range" min="0" max="1" step="0.05" id="s-master" value="${s.master}"></div>
      <div class="setting"><span>Music</span><input type="range" min="0" max="1" step="0.05" id="s-music" value="${s.music}"></div>
      <div class="setting"><span>Effects</span><input type="range" min="0" max="1" step="0.05" id="s-sfx" value="${s.sfx}"></div>
      <div class="setting"><span>Graphics quality</span><select id="s-quality"><option value="high">High</option><option value="medium">Medium</option><option value="low">Low (no bloom)</option></select></div>
      <div class="setting"><span>Screen shake</span><input type="checkbox" id="s-shake" ${s.shake ? 'checked' : ''}></div>
      <div class="setting"><span>Damage numbers</span><input type="checkbox" id="s-dmg" ${s.damageNumbers ? 'checked' : ''}></div>
      <div class="setting"><span>Tutorial hints</span><input type="checkbox" id="s-hints" ${s.hints ? 'checked' : ''}></div>
      <div class="row"><button class="btn primary" id="s-close">Done</button></div>`;
    (card.querySelector('#s-quality') as HTMLSelectElement).value = s.quality;
    const bind = (id: string, fn: (el: HTMLInputElement) => void) => card.querySelector(`#${id}`)!.addEventListener('input', (e) => {
      fn(e.target as HTMLInputElement);
      this.apply();
    });
    bind('s-master', (el) => (s.master = Number(el.value)));
    bind('s-music', (el) => (s.music = Number(el.value)));
    bind('s-sfx', (el) => {
      s.sfx = Number(el.value);
      audio.play('pickupXenite');
    });
    bind('s-shake', (el) => (s.shake = el.checked));
    bind('s-dmg', (el) => (s.damageNumbers = el.checked));
    bind('s-hints', (el) => (s.hints = el.checked));
    card.querySelector('#s-quality')!.addEventListener('change', (e) => {
      s.quality = (e.target as HTMLSelectElement).value as Quality;
      this.apply();
    });
    card.querySelector('#s-close')!.addEventListener('click', () => {
      audio.play('uiClick');
      this.menu(this.settingsEl, false);
      this.settingsReturn();
    });
    this.menu(this.settingsEl, true);
  }

  apply(): void {
    const s = this.settings;
    saveSettings(s);
    audio.setVolumes({ master: s.master, music: s.music, sfx: s.sfx });
    this.game.applySettings(s);
  }

  get fabOpen(): boolean {
    return this.fab.classList.contains('show');
  }

  showFabricator(v: boolean): void {
    if (v) this.renderFabricator();
    this.menu(this.fab, v);
  }

  renderFabricator(): void {
    const g = this.game;
    const card = document.getElementById('fab-card')!;
    const inv = g.inventory;
    const cols: Record<string, string[]> = { Blaster: [], Suit: [], Ship: [] };
    for (const u of UPGRADES) {
      const lvl = g.levels[u.id];
      const maxed = lvl >= u.max;
      const cost = maxed ? null : u.cost(lvl);
      const poor = cost !== null && (inv.xenite < cost.xenite || inv.scrap < cost.scrap);
      const price = maxed ? 'MAX' : `${cost!.xenite ? `${cost!.xenite} xen` : ''}${cost!.xenite && cost!.scrap ? ' · ' : ''}${cost!.scrap ? `${cost!.scrap} scrap` : ''}`;
      const pips = Array.from({ length: u.max }, (_, i) => `<i class="${i < lvl ? 'on' : ''}"></i>`).join('');
      const next = maxed ? u.per(lvl) : `Next: ${u.per(lvl + 1)}`;
      cols[u.cat].push(
        `<div class="up${maxed ? ' maxed' : ''}${poor ? ' poor' : ''}" data-up="${u.id}">
           <div class="top"><span class="nm"><span class="ic">${u.icon}</span>${u.name}</span><span class="price">${price}</span></div>
           <div class="ds">${u.desc} — ${next}</div>
           <div class="pips">${pips}</div>
         </div>`,
      );
    }
    const secs = (Object.keys(SECONDARIES) as SecondaryId[])
      .map((id) => {
        const d = SECONDARIES[id];
        const unlocked = g.unlockedSecondaries.has(id);
        return `<div class="sec${g.secondary === id ? ' sel' : ''}${unlocked ? '' : ' locked'}" data-sec="${id}" title="${d.desc}"><div class="g">${d.icon}</div>${unlocked ? d.name : 'Locked'}</div>`;
      })
      .join('');
    const hullMissing = Math.max(0, Math.round(g.stats.shipHull - g.ship.hull));
    const repairCost = Math.min(inv.scrap, Math.ceil(hullMissing / 6));
    cols.Ship.push(
      `<div class="up${hullMissing <= 0 || inv.scrap <= 0 ? ' maxed' : ''}" data-repair="1">
         <div class="top"><span class="nm"><span class="ic">✚</span>Patch hull</span><span class="price">${hullMissing <= 0 ? 'FULL' : `${repairCost} scrap`}</span></div>
         <div class="ds">1 scrap restores 6 hull (${hullMissing} missing)</div>
       </div>`,
    );
    cols.Blaster.push(`<h3 style="margin-top:12px">Secondary weapon</h3><div class="sec-row">${secs}</div>`);
    card.innerHTML = `
      <div class="fab-head">
        <div><h2>Fabricator</h2><div class="sub" style="margin:0">Ship systems · upgrades are permanent for this run</div></div>
        <div class="fab-res"><span><div class="icon xenite" style="width:14px;height:14px;background:linear-gradient(180deg,#bffcff,#20c8ff);clip-path:polygon(50% 0,100% 50%,50% 100%,0 50%)"></div>${inv.xenite}</span>
        <span><div style="width:14px;height:14px;background:linear-gradient(135deg,#cfd4dc,#6a707a);clip-path:polygon(20% 0,100% 10%,85% 100%,0 80%)"></div>${inv.scrap}</span></div>
      </div>
      <div class="fab-cols">
        <div class="fab-col"><h3>Blaster</h3>${cols.Blaster.join('')}</div>
        <div class="fab-col"><h3>Suit</h3>${cols.Suit.join('')}</div>
        <div class="fab-col"><h3>Ship</h3>${cols.Ship.join('')}</div>
      </div>
      <div class="row"><button class="btn primary" id="fab-close">Close <kbd>E</kbd></button></div>`;
    card.querySelectorAll('[data-up]').forEach((el) =>
      el.addEventListener('click', () => {
        const id = (el as HTMLElement).dataset.up as (typeof UPGRADES)[number]['id'];
        if (g.buyUpgrade(id)) this.renderFabricator();
      }),
    );
    card.querySelectorAll('[data-sec]').forEach((el) =>
      el.addEventListener('click', () => {
        const id = (el as HTMLElement).dataset.sec as SecondaryId;
        if (!g.unlockedSecondaries.has(id)) {
          audio.play('uiError');
          return;
        }
        g.secondary = id;
        audio.play('uiClick');
        this.renderFabricator();
      }),
    );
    card.querySelector('[data-repair]')?.addEventListener('click', () => {
      if (g.repairShip()) this.renderFabricator();
    });
    card.querySelector('#fab-close')!.addEventListener('click', () => g.closeFabricator());
  }

  showEnd(victory: boolean, reason: string): void {
    const g = this.game;
    const r = g.record;
    const acc = r.shots > 0 ? Math.round((r.hits / r.shots) * 100) : 0;
    const newBest = victory ? saveBest({ time: g.playTime, difficulty: g.difficulty.id, kills: r.kills }) : false;
    const card = document.getElementById('end-card')!;
    card.innerHTML = `
      <div class="end-title">
        <h2 style="color:${victory ? '#b0ffd0' : '#ff8a9a'}">${victory ? 'Escaped Kessra' : 'Signal lost'}</h2>
        <div class="sub">${reason}${newBest ? ' · <span style="color:#ffc34a">NEW BEST TIME</span>' : ''}</div>
      </div>
      <div class="stats">
        <div class="stat"><div class="label">Time on Kessra</div><div class="v">${formatTime(g.playTime)}</div></div>
        <div class="stat"><div class="label">Nights survived</div><div class="v">${r.nights}</div></div>
        <div class="stat"><div class="label">Components recovered</div><div class="v">${g.ship.installed.length} / 4</div></div>
        <div class="stat"><div class="label">Creatures killed</div><div class="v">${r.kills}</div></div>
        <div class="stat"><div class="label">Xenite harvested</div><div class="v">${r.xenite}</div></div>
        <div class="stat"><div class="label">Scrap salvaged</div><div class="v">${r.scrap}</div></div>
        <div class="stat"><div class="label">Defences built</div><div class="v">${r.built}</div></div>
        <div class="stat"><div class="label">Logs recovered</div><div class="v">${r.logs} / 8</div></div>
        <div class="stat"><div class="label">Accuracy</div><div class="v">${acc}%</div></div>
      </div>
      <div class="row">
        <button class="btn primary" id="end-again">${victory ? 'New expedition' : 'Try again'}</button>
        <button class="btn" id="end-title">Title screen</button>
      </div>`;
    card.querySelector('#end-again')!.addEventListener('click', () => {
      audio.play('uiClick');
      g.startRun(g.difficulty.id);
    });
    card.querySelector('#end-title')!.addEventListener('click', () => {
      audio.play('uiClick');
      g.toTitle();
    });
    this.menu(this.end, true);
  }
}
