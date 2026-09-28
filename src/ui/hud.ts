import * as THREE from 'three';
import { PARTS, PartId, SHIP, STRUCTURES, WORLD } from '../config';
import { clamp, dist, formatTime, TAU } from '../core/math';
import { BIOMES } from '../world/terrain';
import type { Game } from '../game';

const el = <T extends HTMLElement = HTMLElement>(root: ParentNode, sel: string) => root.querySelector(sel) as T;
const v3 = new THREE.Vector3();

interface DmgNum {
  el: HTMLDivElement;
  x: number;
  y: number;
  z: number;
  t: number;
  active: boolean;
  dx: number;
}

interface Marker {
  el: HTMLDivElement;
  key: string;
  used: boolean;
}

/** In-game heads-up display (DOM based). */
export class Hud {
  readonly root: HTMLDivElement;
  private hpFill: HTMLElement;
  private hpGhost: HTMLElement;
  private hpVal: HTMLElement;
  private o2Bar: HTMLElement;
  private o2Fill: HTMLElement;
  private o2Val: HTMLElement;
  private lives: HTMLElement;
  private objectives: HTMLElement;
  private cycleTitle: HTMLElement;
  private cycleKnob: HTMLElement;
  private cycleSub: HTMLElement;
  private mini: HTMLCanvasElement;
  private miniCtx: CanvasRenderingContext2D;
  private miniMeta: HTMLElement;
  private hullFill: HTMLElement;
  private hullVal: HTMLElement;
  private scrapN: HTMLElement;
  private xenN: HTMLElement;
  private scrapBox: HTMLElement;
  private xenBox: HTMLElement;
  private slots: HTMLElement[] = [];
  private chipDash: HTMLElement;
  private chipSec: HTMLElement;
  private chipSecName: HTMLElement;
  private prompt: HTMLElement;
  private boss: HTMLElement;
  private bossFill: HTMLElement;
  private bossGhost: HTMLElement;
  private markers: HTMLElement;
  private dmgLayer: HTMLElement;
  private crosshair: HTMLElement;
  private heatArc: SVGCircleElement;
  private hurt: HTMLElement;
  private lowair: HTMLElement;
  private flash: HTMLElement;
  readonly fadeEl: HTMLElement;
  private dmgPool: DmgNum[] = [];
  private markerPool: Marker[] = [];
  private hurtV = 0;
  private flashV = 0;
  private worldMap: HTMLCanvasElement | null = null;
  private frame = 0;
  private pings: { a: number; t: number }[] = [];
  pointerOverUi = false;
  showDamageNumbers = true;
  private objT = 0;
  private lastObjHtml = '';

  constructor(
    private game: Game,
    parent: HTMLElement,
  ) {
    const root = document.createElement('div');
    root.id = 'hud';
    root.innerHTML = `
      <div class="markers" id="markers"></div>
      <div class="dmg-layer" id="dmg-layer"></div>
      <div class="hud-tl">
        <div class="vital">
          <div class="vital-head"><span class="label">Suit integrity</span><span class="val" id="hp-val">100</span></div>
          <div class="bar hp"><div class="ghost" id="hp-ghost"></div><div class="fill" id="hp-fill"></div></div>
        </div>
        <div class="vital">
          <div class="vital-head"><span class="label">Oxygen</span><span class="val" id="o2-val">80s</span></div>
          <div class="bar o2" id="o2-bar"><div class="fill" id="o2-fill"></div></div>
        </div>
        <div class="lives" id="lives"></div>
        <div class="objectives panel" id="objectives"></div>
      </div>
      <div class="hud-tc">
        <div class="cycle-title" id="cycle-title">Day 1</div>
        <div class="cycle-track"><div class="cycle-knob" id="cycle-knob"></div></div>
        <div class="cycle-sub" id="cycle-sub"></div>
      </div>
      <div class="toasts" id="toasts"></div>
      <div class="boss" id="boss"><div class="name">THE MATRIARCH</div><div class="bar"><div class="ghost" id="boss-ghost"></div><div class="fill" id="boss-fill"></div></div></div>
      <div class="hud-tr">
        <div class="minimap"><canvas id="minimap" width="196" height="196"></canvas></div>
        <div class="minimap-meta" id="mini-meta"></div>
        <div class="vital hull-mini">
          <div class="vital-head"><span class="label">Ship hull</span><span class="val" id="hull-val">100%</span></div>
          <div class="bar hull"><div class="fill" id="hull-fill"></div></div>
        </div>
      </div>
      <div class="hud-bl">
        <div class="res panel" id="res-scrap"><div class="icon scrap"></div><div><div class="n" id="scrap-n">0</div><div class="label">Scrap</div></div></div>
        <div class="res panel" id="res-xen"><div class="icon xenite"></div><div><div class="n" id="xen-n">0</div><div class="label">Xenite</div></div></div>
      </div>
      <div class="hud-bc">
        <div class="chips">
          <div class="chip panel" id="chip-sec"><span class="k">RMB</span><span id="chip-sec-name">Grenade</span><div class="cd"></div></div>
          <div class="chip panel" id="chip-dash"><span class="k">SPACE</span><span>Dash</span><div class="cd"></div></div>
        </div>
        <div class="buildbar" id="buildbar"></div>
      </div>
      <div class="hud-br" id="comms"></div>
      <div class="prompt panel" id="prompt"></div>
      <div class="hint panel" id="hint"></div>
      <div class="announce" id="announce"><div class="t"></div><div class="s"></div></div>
    `;
    parent.appendChild(root);
    this.root = root;
    this.hpFill = el(root, '#hp-fill');
    this.hpGhost = el(root, '#hp-ghost');
    this.hpVal = el(root, '#hp-val');
    this.o2Bar = el(root, '#o2-bar');
    this.o2Fill = el(root, '#o2-fill');
    this.o2Val = el(root, '#o2-val');
    this.lives = el(root, '#lives');
    this.objectives = el(root, '#objectives');
    this.cycleTitle = el(root, '#cycle-title');
    this.cycleKnob = el(root, '#cycle-knob');
    this.cycleSub = el(root, '#cycle-sub');
    this.mini = el<HTMLCanvasElement>(root, '#minimap');
    this.miniCtx = this.mini.getContext('2d')!;
    this.miniMeta = el(root, '#mini-meta');
    this.hullFill = el(root, '#hull-fill');
    this.hullVal = el(root, '#hull-val');
    this.scrapN = el(root, '#scrap-n');
    this.xenN = el(root, '#xen-n');
    this.scrapBox = el(root, '#res-scrap');
    this.xenBox = el(root, '#res-xen');
    this.chipDash = el(root, '#chip-dash');
    this.chipSec = el(root, '#chip-sec');
    this.chipSecName = el(root, '#chip-sec-name');
    this.prompt = el(root, '#prompt');
    this.boss = el(root, '#boss');
    this.bossFill = el(root, '#boss-fill');
    this.bossGhost = el(root, '#boss-ghost');
    this.markers = el(root, '#markers');
    this.dmgLayer = el(root, '#dmg-layer');

    const bb = el(root, '#buildbar');
    for (const s of STRUCTURES) {
      const d = document.createElement('div');
      d.className = 'slot panel';
      const glyph = s.kind === 'turret' ? '⌖' : s.kind === 'wall' ? '▬' : s.kind === 'lamp' ? '☀' : s.kind === 'beacon' ? '◍' : 'ϟ';
      d.innerHTML = `<span class="key">${s.key}</span><div class="glyph">${glyph}</div><div class="cost"><b>${s.scrap}</b>s${s.xenite ? ` <b>${s.xenite}</b>x` : ''}</div>`;
      d.title = `${s.name} — ${s.desc}`;
      d.addEventListener('mouseenter', () => (this.pointerOverUi = true));
      d.addEventListener('mouseleave', () => (this.pointerOverUi = false));
      d.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        if (this.game.state === 'playing') this.game.structures.select(s.kind);
      });
      bb.appendChild(d);
      this.slots.push(d);
    }

    // crosshair
    const ch = document.createElement('div');
    ch.id = 'crosshair';
    ch.innerHTML = `<svg width="44" height="44" viewBox="0 0 44 44">
        <circle cx="22" cy="22" r="17" fill="none" stroke="rgba(255,255,255,0.18)" stroke-width="2.5"/>
        <circle id="heat-arc" cx="22" cy="22" r="17" fill="none" stroke="#46e8ff" stroke-width="2.5" stroke-dasharray="0 200" transform="rotate(-90 22 22)" stroke-linecap="round"/>
        <circle cx="22" cy="22" r="1.8" fill="#fff"/>
        <path d="M22 8 v5 M22 31 v5 M8 22 h5 M31 22 h5" stroke="#fff" stroke-width="1.6" opacity="0.85"/>
      </svg>`;
    document.body.appendChild(ch);
    this.crosshair = ch;
    this.heatArc = ch.querySelector('#heat-arc') as SVGCircleElement;

    const mk = (id: string, cls = 'overlay') => {
      const d = document.createElement('div');
      d.id = id;
      d.className = cls;
      document.body.appendChild(d);
      return d;
    };
    this.hurt = mk('hurt');
    this.lowair = mk('lowair');
    this.flash = mk('flash');
    this.fadeEl = mk('fade');

    for (let i = 0; i < 48; i++) {
      const d = document.createElement('div');
      d.className = 'dmg';
      d.style.display = 'none';
      this.dmgLayer.appendChild(d);
      this.dmgPool.push({ el: d, x: 0, y: 0, z: 0, t: 0, active: false, dx: 0 });
    }
  }

  setVisible(v: boolean): void {
    this.root.classList.toggle('hidden', !v);
    this.crosshair.classList.toggle('hidden', !v);
  }

  fade(opacity: number, white = false, seconds = 1.2): void {
    this.fadeEl.classList.toggle('white', white);
    this.fadeEl.style.transition = `opacity ${seconds}s`;
    this.fadeEl.style.opacity = String(opacity);
  }

  hurtFlash(k: number): void {
    this.hurtV = Math.max(this.hurtV, k);
  }

  lightningFlash(): void {
    this.flashV = 0.55;
  }

  bump(which: 'scrap' | 'xenite'): void {
    const b = which === 'scrap' ? this.scrapBox : this.xenBox;
    b.classList.remove('bump');
    void b.offsetWidth;
    b.classList.add('bump');
  }

  ping(angle: number): void {
    this.pings.push({ a: angle, t: 6 });
  }

  setPrompt(html: string | null): void {
    if (html === null) {
      this.prompt.classList.remove('show');
      return;
    }
    if (this.prompt.innerHTML !== html) this.prompt.innerHTML = html;
    this.prompt.classList.add('show');
  }

  showBoss(v: boolean): void {
    this.boss.classList.toggle('show', v);
  }

  damageNumber(x: number, y: number, z: number, v: number, crit: boolean): void {
    if (!this.showDamageNumbers) return;
    const d = this.dmgPool.find((q) => !q.active) ?? this.dmgPool[0];
    d.active = true;
    d.x = x;
    d.y = y;
    d.z = z;
    d.t = 0;
    d.dx = (Math.random() - 0.5) * 30;
    d.el.textContent = String(Math.round(v));
    d.el.className = crit ? 'dmg crit' : 'dmg';
    d.el.style.display = 'block';
  }

  /** Renders the static world map (biomes, rocks, pools) once; used by the minimap and the full map. */
  private buildWorldMap(): HTMLCanvasElement {
    const g = this.game;
    const S = 512;
    const cv = document.createElement('canvas');
    cv.width = cv.height = S;
    const ctx = cv.getContext('2d')!;
    const img = ctx.createImageData(S, S);
    const scale = 400 / S;
    for (let j = 0; j < S; j++) {
      for (let i = 0; i < S; i++) {
        const x = -200 + i * scale;
        const z = -200 + j * scale;
        const k = (j * S + i) * 4;
        if (Math.hypot(x, z) > WORLD.radius + 2) {
          img.data[k + 3] = 0;
          continue;
        }
        const b = g.terrain.biomeAt(x, z);
        const hex = parseInt(BIOMES[b].map.slice(1), 16);
        const h = g.terrain.heightAt(x, z);
        const shade = clamp(0.85 + h * 0.05, 0.6, 1.25);
        img.data[k] = ((hex >> 16) & 255) * shade;
        img.data[k + 1] = ((hex >> 8) & 255) * shade;
        img.data[k + 2] = (hex & 255) * shade;
        img.data[k + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    const toPx = (v: number) => (v + 200) / scale;
    ctx.fillStyle = 'rgba(10,8,10,0.4)';
    for (const o of g.layout.obstacles) {
      if (o.kind === 'node') continue;
      ctx.beginPath();
      ctx.arc(toPx(o.x), toPx(o.z), Math.max(1, o.r / scale), 0, TAU);
      ctx.fill();
    }
    ctx.fillStyle = 'rgba(120,255,60,0.85)';
    for (const p of g.layout.pools) {
      ctx.beginPath();
      ctx.arc(toPx(p.x), toPx(p.z), p.r / scale, 0, TAU);
      ctx.fill();
    }
    return cv;
  }

  get worldMapCanvas(): HTMLCanvasElement {
    if (!this.worldMap) this.worldMap = this.buildWorldMap();
    return this.worldMap;
  }

  resetWorldMap(): void {
    this.worldMap = null;
  }

  /** Draws map content (used by minimap and full map). */
  drawMap(ctx: CanvasRenderingContext2D, size: number, cx: number, cz: number, radius: number, full: boolean): void {
    const g = this.game;
    const wm = this.worldMapCanvas;
    const scale = size / (radius * 2);
    ctx.save();
    ctx.clearRect(0, 0, size, size);
    ctx.fillStyle = '#07080c';
    ctx.fillRect(0, 0, size, size);
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2, 0, TAU);
    ctx.clip();
    const pxPerM = 512 / 400;
    const sx = (cx - radius + 200) * pxPerM;
    const sz = (cz - radius + 200) * pxPerM;
    ctx.globalAlpha = 0.92;
    ctx.drawImage(wm, sx, sz, radius * 2 * pxPerM, radius * 2 * pxPerM, 0, 0, size, size);
    ctx.globalAlpha = 1;
    const tx = (x: number) => (x - cx) * scale + size / 2;
    const tz = (z: number) => (z - cz) * scale + size / 2;
    const dot = (x: number, z: number, r: number, c: string) => {
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(tx(x), tz(z), r, 0, TAU);
      ctx.fill();
    };
    // night fog of the map
    const dark = g.cycle.darkness;
    if (dark > 0) {
      ctx.fillStyle = `rgba(0,0,12,${dark * 0.45})`;
      ctx.fillRect(0, 0, size, size);
    }
    // structures
    for (const s of g.structures.list) dot(s.x, s.z, full ? 3 : 2, s.kind === 'beacon' ? '#46c8ff' : '#ffd04a');
    // beacons' air fields
    // resources (xenite) as faint dots when near
    if (!full) for (const n of g.resources.nodes) if (n.alive && n.kind === 'xenite') dot(n.x, n.z, 1.6, 'rgba(80,240,255,0.7)');
    for (const pl of g.resources.plants) if (pl.kind === 'bulb' && pl.ready) dot(pl.x, pl.z, full ? 2.2 : 1.6, 'rgba(95,216,255,0.9)');
    // wrecks
    for (let i = 0; i < g.layout.wrecks.length; i++) {
      const w = g.layout.wrecks[i];
      if (!g.wreckSeen[i] && !full) continue;
      ctx.strokeStyle = g.wreckLooted[i] ? 'rgba(160,160,160,0.6)' : '#ffc34a';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(tx(w.x) - 3, tz(w.z) - 3, 6, 6);
    }
    // enemies
    for (const e of g.enemies.list) {
      if (e.state === 5) continue;
      if (e.kind === 'nest') {
        if (dist(e.x, e.z, g.player.x, g.player.z) < 90 || full) dot(e.x, e.z, full ? 4 : 3.5, '#ff3355');
        continue;
      }
      if (full) continue;
      dot(e.x, e.z, e.kind === 'brute' || e.kind === 'matriarch' ? 3 : 1.8, '#ff4a5a');
    }
    // parts
    for (const p of g.layout.parts) {
      const st = g.partState[p.id];
      if (st !== 'field' && st !== 'dropped') continue;
      const pos = st === 'dropped' ? g.droppedPart! : p;
      const c = '#' + PARTS[p.id].color.toString(16).padStart(6, '0');
      ctx.save();
      ctx.translate(tx(pos.x), tz(pos.z));
      ctx.rotate(Math.PI / 4);
      ctx.fillStyle = c;
      ctx.shadowColor = c;
      ctx.shadowBlur = 8;
      const s = full ? 9 : 7;
      ctx.fillRect(-s / 2, -s / 2, s, s);
      ctx.restore();
    }
    // ship
    ctx.fillStyle = '#ffb06a';
    ctx.save();
    ctx.translate(tx(g.ship.x), tz(g.ship.z));
    ctx.beginPath();
    ctx.arc(0, 0, full ? 7 : 5, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,176,106,0.5)';
    ctx.beginPath();
    ctx.arc(0, 0, 9.5 * scale, 0, TAU);
    ctx.stroke();
    ctx.restore();
    // pings
    for (const p of this.pings) {
      const r = (size / 2) * 0.92;
      const px = size / 2 + Math.cos(p.a) * r;
      const pz = size / 2 + Math.sin(p.a) * r;
      if (!full) {
        ctx.strokeStyle = `rgba(255,70,90,${Math.min(1, p.t / 2) * (0.5 + 0.5 * Math.sin(p.t * 10))})`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(size / 2, size / 2, r, p.a - 0.3, p.a + 0.3);
        ctx.stroke();
      } else {
        dot(g.ship.x + Math.cos(p.a) * 48, g.ship.z + Math.sin(p.a) * 48, 6, 'rgba(255,70,90,0.6)');
      }
      void px;
      void pz;
    }
    // player
    const pl = g.player;
    ctx.save();
    ctx.translate(tx(pl.x), tz(pl.z));
    ctx.rotate(-pl.facing + Math.PI);
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.moveTo(0, -6);
    ctx.lineTo(4.5, 5);
    ctx.lineTo(0, 2.5);
    ctx.lineTo(-4.5, 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.restore();
    // ring
    ctx.strokeStyle = 'rgba(160,200,255,0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2 - 1, 0, TAU);
    ctx.stroke();
  }

  private objectivesHtml(): string {
    const g = this.game;
    const p = g.player;
    const rows: string[] = [];
    const installed = g.ship.installed.length;
    if (g.launching) {
      const left = Math.max(0, g.launchRemaining);
      rows.push(
        left > 0
          ? `<div class="obj urgent"><span class="dot" style="background:#ff7a2a"></span>Defend the ship — launch in ${formatTime(left)}</div>`
          : `<div class="obj urgent"><span class="dot" style="background:#ff7a2a"></span>Engines hot — get aboard the ship!</div>`,
      );
      return `<h4>Final Stand</h4>${rows.join('')}`;
    }
    for (const part of g.layout.parts) {
      const st = g.partState[part.id];
      const c = '#' + PARTS[part.id].color.toString(16).padStart(6, '0');
      let label: string = PARTS[part.id].name;
      let dd = '';
      let cls = 'obj';
      if (st === 'installed') cls += ' done';
      else if (st === 'carried') {
        label = `Deliver ${PARTS[part.id].name}`;
        cls += ' urgent';
        dd = `${Math.round(dist(p.x, p.z, g.ship.x, g.ship.z))}m`;
      } else {
        const pos = st === 'dropped' ? g.droppedPart! : part;
        dd = `${Math.round(dist(p.x, p.z, pos.x, pos.z))}m`;
        if (part.id === 'reactor' && st === 'field') label += ' ⚠';
        if (st === 'dropped') label += ' (dropped)';
      }
      rows.push(`<div class="${cls}"><span class="dot" style="background:${c};box-shadow:0 0 6px ${c}"></span>${label}<span class="dist">${dd}</span></div>`);
    }
    const ttn = g.cycle.timeToNight();
    const farFromShip = dist(p.x, p.z, g.ship.x, g.ship.z) > 30;
    if (g.cycle.phase === 'night') rows.push(`<div class="obj urgent"><span class="dot" style="background:#6a7cff"></span>Survive until dawn — ${formatTime(g.cycle.timeLeft)}</div>`);
    else if (ttn < 60 && farFromShip) rows.push(`<div class="obj urgent"><span class="dot" style="background:#ff7a2a"></span>Return to the ship before dark</div>`);
    return `<h4>Repair the ship · ${installed}/4</h4>${rows.join('')}`;
  }

  update(dt: number): void {
    const g = this.game;
    const p = g.player;
    const st = g.stats;
    this.frame++;
    // vitals
    const hpK = clamp(p.hp / st.maxHp, 0, 1);
    this.hpFill.style.transform = `scaleX(${hpK})`;
    this.hpGhost.style.transform = `scaleX(${hpK})`;
    this.hpVal.textContent = `${Math.ceil(p.hp)} / ${st.maxHp}`;
    const o2K = p.o2Frac;
    this.o2Fill.style.transform = `scaleX(${o2K})`;
    this.o2Val.textContent = p.inAir ? 'BREATHABLE' : `${Math.ceil(p.o2)}s`;
    this.o2Bar.classList.toggle('low', o2K < 0.25 && !p.inAir);
    this.o2Bar.classList.toggle('refill', p.inAir && o2K < 0.999);
    // lives
    const livesHtml = Array.from({ length: g.difficulty.lives }, (_, i) => `<div class="pip${i < g.lives ? '' : ' lost'}"></div>`).join('') + '<span class="label" style="margin-left:6px">Reconstructions</span>';
    if (this.lives.dataset.v !== livesHtml) {
      this.lives.innerHTML = livesHtml;
      this.lives.dataset.v = livesHtml;
    }
    // objectives (throttled)
    this.objT -= dt;
    if (this.objT <= 0) {
      this.objT = 0.25;
      const html = this.objectivesHtml();
      if (html !== this.lastObjHtml) {
        this.objectives.innerHTML = html;
        this.lastObjHtml = html;
      }
    }
    // cycle
    const c = g.cycle;
    const total = c.length('day') + c.length('dusk') + c.length('night') + c.length('dawn');
    let pos = 0;
    if (c.phase === 'day') pos = c.t;
    else if (c.phase === 'dusk') pos = c.length('day') + c.t;
    else if (c.phase === 'night') pos = c.length('day') + c.length('dusk') + c.t;
    else pos = c.length('day') + c.length('dusk') + c.length('night') + c.t;
    this.cycleKnob.style.left = `${(pos / total) * 100}%`;
    this.cycleKnob.style.background = c.darkness > 0.5 ? '#aab8ff' : '#fff';
    this.cycleTitle.textContent = g.launching ? 'LAUNCH SEQUENCE' : `${c.phase === 'night' ? 'Night' : 'Day'} ${c.day}`;
    let sub = '';
    let warn = false;
    if (g.launching) {
      sub = g.launchRemaining > 0 ? `ENGINES ${Math.round((1 - g.launchRemaining / SHIP.launchTime) * 100)}% — ${formatTime(g.launchRemaining)}` : 'ENGINES HOT — BOARD NOW';
      warn = true;
    } else if (c.phase === 'day') {
      sub = `Nightfall in ${formatTime(c.timeToNight())}`;
      warn = c.timeToNight() < 45;
    } else if (c.phase === 'dusk') {
      sub = `Nightfall in ${formatTime(c.timeLeft)}`;
      warn = true;
    } else if (c.phase === 'night') sub = `Dawn in ${formatTime(c.timeLeft + 0)}`;
    else sub = 'Dawn';
    this.cycleSub.textContent = sub;
    this.cycleSub.classList.toggle('warn', warn);
    // resources
    this.scrapN.textContent = String(g.inventory.scrap);
    this.xenN.textContent = String(g.inventory.xenite);
    // hull
    const hullK = clamp(g.ship.hull / st.shipHull, 0, 1);
    this.hullFill.style.transform = `scaleX(${hullK})`;
    this.hullVal.textContent = `${Math.round(hullK * 100)}%`;
    // build bar
    for (let i = 0; i < STRUCTURES.length; i++) {
      const s = STRUCTURES[i];
      const slot = this.slots[i];
      slot.classList.toggle('unaffordable', !g.structures.canAfford(s.kind));
      slot.classList.toggle('active', g.structures.placing === s.kind);
    }
    // chips
    const dashK = p.dashCd > 0 ? 1 - p.dashCd / st.dashCooldown : 1;
    (this.chipDash.querySelector('.cd') as HTMLElement).style.width = `${dashK * 100}%`;
    this.chipDash.classList.toggle('cooling', dashK < 1);
    const secMax = st.secondaryCooldown * g.secondaryDef.cooldownMult;
    const secK = p.secondaryCd > 0 ? 1 - p.secondaryCd / secMax : 1;
    (this.chipSec.querySelector('.cd') as HTMLElement).style.width = `${secK * 100}%`;
    this.chipSec.classList.toggle('cooling', secK < 1);
    if (this.chipSecName.textContent !== g.secondaryDef.name) this.chipSecName.textContent = g.secondaryDef.name;
    // minimap
    if (this.frame % 2 === 0) {
      this.drawMap(this.miniCtx, 196, p.x, p.z, 64, false);
      const biome = BIOMES[g.terrain.biomeAt(p.x, p.z)].name;
      if (this.miniMeta.textContent !== biome) this.miniMeta.textContent = biome;
    }
    for (const q of this.pings) q.t -= dt;
    this.pings = this.pings.filter((q) => q.t > 0);
    // boss
    const b = g.enemies.boss;
    if (b) {
      const k = clamp(b.hp / b.maxHp, 0, 1);
      this.bossFill.style.transform = `scaleX(${k})`;
      this.bossGhost.style.transform = `scaleX(${k})`;
    }
    // crosshair
    const inp = g.input;
    this.crosshair.style.transform = `translate(${inp.mouseX}px, ${inp.mouseY}px)`;
    const heat = p.overheated ? 1 : p.heat;
    const circ = 2 * Math.PI * 17;
    this.heatArc.setAttribute('stroke-dasharray', `${heat * circ} ${circ}`);
    this.heatArc.setAttribute('stroke', p.overheated ? '#ff3a5a' : heat > 0.7 ? '#ffb04a' : '#46e8ff');
    // overlays
    this.hurtV = Math.max(0, this.hurtV - dt * 1.8);
    const lowHp = hpK < 0.3 ? (0.3 - hpK) * 1.6 * (0.7 + 0.3 * Math.sin(g.time * 6)) : 0;
    this.hurt.style.opacity = String(Math.min(1, this.hurtV + lowHp));
    const air = !p.inAir && o2K < 0.3 ? ((0.3 - o2K) / 0.3) * (0.75 + 0.25 * Math.sin(g.time * 3)) : 0;
    this.lowair.style.opacity = String(air);
    this.flashV = Math.max(0, this.flashV - dt * 3);
    this.flash.style.opacity = String(this.flashV);
    this.updateMarkers();
    this.updateDamageNumbers(dt);
  }

  private project(x: number, y: number, z: number): { x: number; y: number; behind: boolean } {
    v3.set(x, y, z).project(this.game.renderer.rig.camera);
    return { x: (v3.x * 0.5 + 0.5) * window.innerWidth, y: (-v3.y * 0.5 + 0.5) * window.innerHeight, behind: v3.z > 1 };
  }

  private updateDamageNumbers(dt: number): void {
    for (const d of this.dmgPool) {
      if (!d.active) continue;
      d.t += dt;
      if (d.t > 0.75) {
        d.active = false;
        d.el.style.display = 'none';
        continue;
      }
      const s = this.project(d.x, d.y, d.z);
      const rise = d.t * 50;
      const sc = d.t < 0.08 ? 1.5 - d.t * 6 : 1;
      d.el.style.transform = `translate(${s.x + d.dx * d.t * 2}px, ${s.y - rise}px) translate(-50%, -50%) scale(${sc})`;
      d.el.style.opacity = String(d.t > 0.5 ? 1 - (d.t - 0.5) / 0.25 : 1);
    }
  }

  private marker(key: string): HTMLDivElement {
    let m = this.markerPool.find((q) => q.key === key);
    if (!m) {
      m = this.markerPool.find((q) => !q.used && q.key === '');
      if (!m) {
        const d = document.createElement('div');
        d.className = 'marker';
        this.markers.appendChild(d);
        m = { el: d, key: '', used: false };
        this.markerPool.push(m);
      }
      m.key = key;
    }
    m.used = true;
    return m.el;
  }

  private updateMarkers(): void {
    const g = this.game;
    const p = g.player;
    for (const m of this.markerPool) m.used = false;
    const W = window.innerWidth;
    const H = window.innerHeight;
    const edgePlaced: { x: number; y: number }[] = [];
    const place = (key: string, x: number, y: number, z: number, color: string, label: string, alwaysShow: boolean) => {
      const d = dist(p.x, p.z, x, z);
      const s = this.project(x, y, z);
      const margin = 70;
      const top = 96;
      const bottom = 150;
      const onScreen = !s.behind && s.x > margin && s.x < W - margin && s.y > top && s.y < H - bottom;
      if (onScreen && !alwaysShow && d < 14) return;
      const elx = this.marker(key);
      elx.style.color = color;
      if (onScreen) {
        const html = `<div class="diamond"></div><div>${label}</div><div class="d">${Math.round(d)}m</div>`;
        if (elx.dataset.h !== html) {
          elx.innerHTML = html;
          elx.dataset.h = html;
        }
        elx.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%, -100%)`;
      } else {
        // clamp to screen edge along the direction from the screen centre
        let dx = s.x - W / 2;
        let dy = s.y - H / 2;
        if (s.behind) {
          dx = -dx;
          dy = -dy;
        }
        const cy = (top + H - bottom) / 2;
        dy += H / 2 - cy;
        const k = Math.min((W / 2 - margin) / Math.max(Math.abs(dx), 1e-3), ((H - top - bottom) / 2) / Math.max(Math.abs(dy), 1e-3));
        let ex = W / 2 + dx * k;
        let ey = cy + dy * k;
        // keep edge markers from stacking on top of each other
        const onSide = Math.abs(ex - W / 2) >= W / 2 - margin - 1;
        for (let iter = 0; iter < 5; iter++) {
          let moved = false;
          for (const q of edgePlaced) {
            if (Math.abs(q.x - ex) < 60 && Math.abs(q.y - ey) < 38) {
              if (onSide) ey = q.y + (ey >= q.y ? 40 : -40);
              else ex = q.x + (ex >= q.x ? 62 : -62);
              moved = true;
            }
          }
          if (!moved) break;
        }
        edgePlaced.push({ x: ex, y: ey });
        const ang = Math.atan2(dy, dx) + Math.PI / 2;
        const html = `<div class="arrow" style="transform:rotate(${ang.toFixed(2)}rad)"></div><div>${label}</div><div class="d">${Math.round(d)}m</div>`;
        elx.innerHTML = html;
        elx.dataset.h = '';
        elx.style.transform = `translate(${ex}px, ${ey}px) translate(-50%, -50%)`;
      }
    };
    if (g.state === 'playing' || g.state === 'paused') {
      for (const part of g.layout.parts) {
        const st = g.partState[part.id];
        if (st !== 'field' && st !== 'dropped') continue;
        const pos = st === 'dropped' ? g.droppedPart! : part;
        const c = '#' + PARTS[part.id].color.toString(16).padStart(6, '0');
        place(`part-${part.id}`, pos.x, g.terrain.heightAt(pos.x, pos.z) + 3, pos.z, c, PARTS[part.id].short, false);
      }
      const sd = dist(p.x, p.z, g.ship.x, g.ship.z);
      if (sd > 20 || p.carrying) place('ship', g.ship.x, g.ship.y + 6, g.ship.z, '#ffb06a', 'SHIP', false);
      for (let i = 0; i < g.layout.wrecks.length; i++) {
        if (g.wreckLooted[i] || !g.wreckSeen[i]) continue;
        const w = g.layout.wrecks[i];
        if (dist(p.x, p.z, w.x, w.z) < 70) place(`wreck-${i}`, w.x, g.terrain.heightAt(w.x, w.z) + 3, w.z, '#ffc34a', 'WRECK', false);
      }
    }
    for (const m of this.markerPool) {
      if (!m.used && m.key !== '') {
        m.key = '';
        m.el.innerHTML = '';
        m.el.dataset.h = '';
      }
    }
  }
}

export const partColor = (id: PartId): string => '#' + PARTS[id].color.toString(16).padStart(6, '0');
