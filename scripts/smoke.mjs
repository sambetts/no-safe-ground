// Headless smoke test + screenshot tool (SwiftShader: slow rendering, so the simulation is stepped manually).
// Usage: node scripts/smoke.mjs [scenario...]   (dev server must be running; URL env overrides the address)
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const scenarios = process.argv.slice(2);
if (!scenarios.length) scenarios.push('basic');
const url = process.env.URL ?? 'http://localhost:5317/';
const W = Number(process.env.W ?? 1600);
const H = Number(process.env.H ?? 900);
mkdirSync('screenshots', { recursive: true });

const browser = await chromium.launch({
  channel: 'msedge',
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errors = [];
page.on('console', (m) => {
  const t = m.text();
  if ((m.type() === 'error' || m.type() === 'warning') && !t.includes('404') && !t.includes('GPU stall') && !t.includes('GL Driver Message')) errors.push(`[${m.type()}] ${t}`);
});
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}\n${e.stack ?? ''}`));

const wait = (ms) => page.waitForTimeout(ms);
const ev = (fn, arg) => page.evaluate(fn, arg);
const step = (s) => ev((sec) => window.__game.step(sec), s);
const draw = () => ev(() => window.__game.update(0.001, true));
const shot = async (name) => {
  // god-mode scenarios inflate hp/hull; show real values in the captured HUD, then restore them
  const saved = await ev(() => {
    const g = window.__game;
    if (!g.player || !g.ship) return null;
    const s = { hp: g.player.hp, hull: g.ship.hull };
    g.player.hp = Math.min(g.player.hp, g.stats.maxHp);
    g.ship.hull = Math.min(g.ship.hull, g.stats.shipHull);
    return s;
  });
  await draw();
  await draw();
  await page.screenshot({ path: `screenshots/${name}.png` });
  if (saved)
    await ev((s) => {
      const g = window.__game;
      if (g.player.hp > 0) g.player.hp = s.hp;
      if (g.ship.hull > 0) g.ship.hull = s.hull;
    }, saved);
  console.log('shot', name);
};

await page.goto(url);
await page.waitForFunction(() => !!window.__game, null, { timeout: 90000 });
await wait(1500);

const startRun = async () => {
  await page.click('#btn-start');
  await wait(900);
};

const ensureRun = async () => {
  if ((await ev(() => window.__game.state)) === 'title') {
    await startRun();
    await step(8);
  }
};

const teleport = (x, z) =>
  ev(
    ([px, pz]) => {
      const g = window.__game;
      g.player.x = px;
      g.player.z = pz;
      g.renderer.rig.target.set(px, g.terrain.heightAt(px, pz), pz);
      g.renderer.rig.snap();
    },
    [x, z],
  );

for (const sc of scenarios) {
  console.log('=== scenario', sc);
  if (sc === 'title') {
    await step(2);
    await shot('title');
    continue;
  }
  if (sc === 'intro') {
    await startRun();
    await step(1.2);
    await shot('intro-1');
    await step(1.4);
    await shot('intro-2');
    await step(1.0);
    await shot('intro-3-impact');
    await step(2.4);
    await shot('intro-4-swoop');
    continue;
  }
  if (sc === 'basic') {
    await ensureRun();
    await shot('play-1');
    await ev(() => (window.__game.input.mouseDown = true));
    await step(0.8);
    await shot('play-2-firing');
    await ev(() => (window.__game.input.mouseDown = false));
    continue;
  }
  if (sc === 'biomes') {
    await ensureRun();
    for (const id of ['coil', 'cell', 'nav', 'reactor']) {
      const p = await ev((pid) => {
        const g = window.__game;
        const q = g.layout.parts.find((k) => k.id === pid);
        g.player.hp = 1e6;
        // stand a little beyond the part (away from the ship) so the frame sits inside its biome
        const dx = q.x - g.ship.x;
        const dz = q.z - g.ship.z;
        const L = Math.hypot(dx, dz) || 1;
        return { x: q.x + (dx / L) * 11, z: q.z + (dz / L) * 11 };
      }, id);
      await teleport(p.x, p.z);
      await step(1.5);
      await shot(`biome-${id}`);
    }
    continue;
  }
  if (sc === 'night') {
    await ensureRun();
    await ev(() => {
      const g = window.__game;
      g.player.hp = 1e6;
      const h = g.ship.hatch();
      g.player.x = h.x + 4;
      g.player.z = h.z + 4;
      g.structures.place('turret', h.x + 8, h.z - 3, 0, true);
      g.structures.place('lamp', h.x + 6, h.z + 6, 0, true);
      g.structures.place('tesla', h.x - 10, h.z + 5, 0, true);
      g.structures.place('beacon', h.x - 6, h.z - 10, 0, true);
      g.cycle.set('dusk', 18);
    });
    await step(4);
    await shot('night-1-fall');
    await step(22);
    await shot('night-2-siege');
    await ev(() => (window.__game.input.mouseDown = true));
    await step(3);
    await shot('night-3-fight');
    await ev(() => (window.__game.input.mouseDown = false));
    continue;
  }
  if (sc === 'regress') {
    // regression checks for bugs found in review (each logs PASS/FAIL)
    const check = (name, ok, extra = '') => {
      console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
      if (!ok) errors.push(`[regress] ${name} ${extra}`);
    };
    const crateColliders = () =>
      ev(() => {
        const g = window.__game;
        return { unique: new Set(g.grid.cells.flat().filter((o) => o.kind === 'crate')).size, crates: g.layout.crates.length };
      });
    await ensureRun();
    let cc = await crateColliders();
    check('one collider per crate (first run)', cc.unique === cc.crates, `${cc.unique} colliders / ${cc.crates} crates`);

    // two parts dropped by successive deaths keep their own spots, and picking one up doesn't crash the HUD
    const drops = await ev(() => {
      const g = window.__game;
      const out = {};
      g.player.hp = 1e6;
      for (const id of ['nav', 'coil']) {
        const q = g.partSpots[id];
        g.player.x = q.x;
        g.player.z = q.z;
        g.step(0.3);
        const carried = g.partState[id] === 'carried';
        g.player.x = q.x + 6;
        g.player.z = q.z + 3;
        out[id] = { x: g.player.x, z: g.player.z, carried };
        g.onPlayerDeath('test');
        g.step(4.5);
        g.player.hp = 1e6;
      }
      return { out, nav: g.partState.nav, coil: g.partState.coil, spots: { nav: g.partSpots.nav, coil: g.partSpots.coil }, alive: g.player.alive };
    });
    check('both parts carried then dropped', drops.out.nav.carried && drops.out.coil.carried && drops.nav === 'dropped' && drops.coil === 'dropped', JSON.stringify({ nav: drops.nav, coil: drops.coil }));
    check('each dropped part keeps its own spot', Math.hypot(drops.spots.nav.x - drops.out.nav.x, drops.spots.nav.z - drops.out.nav.z) < 0.01 && Math.hypot(drops.spots.coil.x - drops.out.coil.x, drops.spots.coil.z - drops.out.coil.z) < 0.01);
    const pick = await ev(() => {
      const g = window.__game;
      g.player.x = g.partSpots.coil.x;
      g.player.z = g.partSpots.coil.z;
      g.step(0.3);
      g.update(0.016, true);
      return { coil: g.partState.coil, nav: g.partState.nav, state: g.state };
    });
    check('pick up second drop without crash', pick.coil === 'carried' && pick.nav === 'dropped' && pick.state === 'playing', JSON.stringify(pick));

    // objective markers (on-screen and edge-clamped) never sit on top of HUD panels
    const ov = await ev(() => {
      const g = window.__game;
      let n = 0;
      const bad = [];
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        const r = 40 + (i % 4) * 35;
        g.player.x = g.ship.x + Math.cos(a) * r;
        g.player.z = g.ship.z + Math.sin(a) * r;
        g.player.hp = 1e6;
        g.renderer.rig.target.set(g.player.x, g.terrain.heightAt(g.player.x, g.player.z), g.player.z);
        g.renderer.rig.snap();
        g.step(0.7);
        const rects = ['.hud-tl', '.hud-tc', '.hud-tr', '.hud-bl', '.hud-bc']
          .map((s) => document.querySelector('#hud ' + s).getBoundingClientRect())
          .filter((q) => q.width > 0 && q.height > 0);
        const edge = [];
        for (const m of document.querySelectorAll('#markers .marker')) {
          if (!m.innerHTML) continue;
          n++;
          const b = m.getBoundingClientRect();
          for (const q of rects)
            if (b.right > q.left + 2 && b.left < q.right - 2 && b.bottom > q.top + 2 && b.top < q.bottom - 2) bad.push(`${m.textContent}@${Math.round(b.left)},${Math.round(b.top)}`);
          if (m.querySelector('.arrow')) {
            for (const [t, q] of edge)
              if (b.right > q.left + 4 && b.left < q.right - 4 && b.bottom > q.top + 4 && b.top < q.bottom - 4) bad.push(`${m.textContent}x${t}`);
            edge.push([m.textContent, b]);
          }
        }
      }
      return { n, bad };
    });
    check('objective markers avoid HUD panels and each other', ov.n > 0 && ov.bad.length === 0, `${ov.bad.length} overlaps / ${ov.n} markers ${ov.bad.slice(0, 4).join(' ')}`);

    // Esc inside pause → settings returns to the pause card instead of resuming underneath
    await ev(() => window.__game.setPaused(true));
    await page.click('#btn-psettings');
    await page.keyboard.press('Escape');
    await step(0.05);
    let st = await ev(() => ({ state: window.__game.state, settings: document.getElementById('settings').classList.contains('show'), pause: document.getElementById('pause').classList.contains('show') }));
    check('Esc closes settings back to pause', st.state === 'paused' && !st.settings && st.pause, JSON.stringify(st));
    await page.keyboard.press('Escape');
    await step(0.05);
    st = await ev(() => ({ state: window.__game.state, pause: document.getElementById('pause').classList.contains('show') }));
    check('second Esc resumes', st.state === 'playing' && !st.pause, JSON.stringify(st));

    // game over → Try again: end card must not come back over the new run
    const seed1 = await ev(() => window.__game.seed);
    await ev(() => {
      const g = window.__game;
      g.lives = 1;
      g.player.hp = 1;
      g.onPlayerDeath('test');
      g.step(3.2);
    });
    st = await ev(() => ({ state: window.__game.state, end: document.getElementById('end').classList.contains('show') }));
    check('game over shows end card', st.state === 'gameover' && st.end, JSON.stringify(st));
    await page.click('#end-again');
    await wait(900);
    await step(0.2);
    await wait(300);
    await step(0.2);
    st = await ev(() => ({ state: window.__game.state, end: document.getElementById('end').classList.contains('show'), menu: document.body.classList.contains('menu-open'), seed: window.__game.seed, dist: window.__game.renderer.rig.targetDistance }));
    check('Try again hides end card', (st.state === 'intro' || st.state === 'playing') && !st.end && !st.menu, JSON.stringify(st));
    check('Try again builds a fresh world', st.seed !== seed1);
    check('camera zoom reset after game over', st.dist === 30, String(st.dist));
    cc = await crateColliders();
    check('one collider per crate (rebuilt world)', cc.unique === cc.crates, `${cc.unique} colliders / ${cc.crates} crates`);

    // Title → Begin after a played run must also generate a fresh world
    await step(8);
    const seed2 = await ev(() => window.__game.seed);
    await ev(() => window.__game.toTitle());
    await wait(900);
    await step(0.1);
    await page.click('#btn-start');
    await wait(900);
    await step(0.2);
    st = await ev(() => ({ state: window.__game.state, seed: window.__game.seed }));
    check('Title → Begin builds a fresh world', st.seed !== seed2 && (st.state === 'intro' || st.state === 'playing'), JSON.stringify(st));
    await step(8);
    continue;
  }
  if (sc === 'launchdef') {
    // balance probe: hull lost during the launch with a modest defence vs none (player idle at the hatch)
    for (const defended of [true, false]) {
      if (!defended) {
        await ev(() => window.__game.startRun('survivor'));
        await wait(900);
        await step(8);
      }
      await ensureRun();
      const r = await ev((def) => {
        const g = window.__game;
        const h = g.ship.hatch();
        g.player.hp = 1e9;
        g.player.x = h.x;
        g.player.z = h.z;
        g.director.nightNumber = 3;
        if (def) {
          for (let i = 0; i < 4; i++) {
            const a = (i / 4) * Math.PI * 2 + 0.4;
            g.structures.place('turret', g.ship.x + Math.cos(a) * 11, g.ship.z + Math.sin(a) * 11, 0, true);
          }
          g.structures.place('tesla', g.ship.x + 12, g.ship.z - 2, 0, true);
          g.structures.place('tesla', g.ship.x - 12, g.ship.z + 2, 0, true);
          g.structures.place('lamp', g.ship.x + 2, g.ship.z + 12, 0, true);
          g.structures.place('lamp', g.ship.x - 2, g.ship.z - 12, 0, true);
        }
        for (const id of ['coil', 'cell', 'nav', 'reactor']) g.installPart(id);
        const start = g.ship.hull;
        const out = [];
        for (let t = 10; t <= 70; t += 10) {
          g.step(10);
          out.push(`${t}s:${Math.round(start - g.ship.hull)}`);
        }
        return `${def ? 'defended' : 'undefended'} hull ${Math.round(start)} lost ${out.join(' ')} kills:${g.record.kills} structures:${g.structures.list.length}`;
      }, defended);
      console.log(r);
    }
    continue;
  }
  if (sc === 'hero') {
    // staged night defence for README/marketing captures
    await ensureRun();
    await ev(() => {
      const g = window.__game;
      g.player.hp = 1e6;
      g.ship.hull = 1e7;
      g.hints.enabled = false;
      g.hints.reset();
      g.messages.clear();
      g.inventory.scrap = 64;
      g.inventory.xenite = 23;
      const px = g.ship.x + 12;
      const pz = g.ship.z + 6;
      g.player.x = px;
      g.player.z = pz;
      g.structures.place('turret', px + 3, pz - 3.5, 0, true);
      g.structures.place('turret', px + 3, pz + 3.5, 0, true);
      g.structures.place('lamp', px + 6.5, pz - 1, 0, true);
      g.structures.place('tesla', px + 1, pz + 7, 0, true);
      for (let i = 0; i < 3; i++) g.structures.place('wall', px + 10, pz - 2.2 + i * 2.2, Math.PI, true);
      g.cycle.set('night', 30);
      g.renderer.rig.target.set(px, g.terrain.heightAt(px, pz), pz);
      g.renderer.rig.snap();
    });
    await step(1);
    await ev(() => {
      const g = window.__game;
      const kinds = ['skitter', 'skitter', 'spitter', 'skitter', 'brute', 'skitter', 'skitter', 'spitter', 'burrower', 'skitter', 'skitter', 'skitter', 'floater', 'skitter'];
      let n = 0;
      for (let i = 0; n < kinds.length && i < 200; i++) {
        const a = -0.95 + Math.random() * 1.9;
        const r = 17 + Math.random() * 9;
        const x = g.player.x + Math.cos(a) * r;
        const z = g.player.z + Math.sin(a) * r;
        if (g.flowShip.blocked[g.flowShip.idx(x, z)]) continue;
        g.enemies.spawn(kinds[n++], x, z, 'hunt', { night: true, aggro: true });
      }
      g.input.mouseX = innerWidth * 0.74;
      g.input.mouseY = innerHeight * 0.47;
      g.input.mouseDown = true;
    });
    await step(1.6);
    await shot('hero-1');
    await step(0.8);
    await shot('hero-2');
    await ev(() => (window.__game.input.mouseDown = false));
    continue;
  }
  if (sc === 'reel') {
    // frames for the README gameplay animation (screenshots/reel/): a staged night siege at a fixed timestep
    const frames = Number(process.env.REEL_FRAMES ?? 105);
    const fps = Number(process.env.REEL_FPS ?? 15);
    mkdirSync('screenshots/reel', { recursive: true });
    await ensureRun();
    await ev(() => {
      const g = window.__game;
      g.hints.enabled = false;
      g.hints.reset();
      g.messages.clear();
      g.renderer.rig.shakeEnabled = false;
      g.inventory.scrap = 999;
      g.inventory.xenite = 999;
      for (const id of ['multi', 'cool', 'cool', 'cool']) g.buyUpgrade(id);
      g.inventory.scrap = 64;
      g.inventory.xenite = 23;
      g.unlockedSecondaries.add('seeker');
      g.secondary = 'seeker';
      g.player.hp = 1e6;
      g.ship.hull = 1e7;
      const px = g.ship.x + 12;
      const pz = g.ship.z + 6;
      g.player.x = px;
      g.player.z = pz;
      g.structures.place('turret', px + 3, pz - 3.5, 0, true);
      g.structures.place('turret', px + 3, pz + 3.5, 0, true);
      g.structures.place('lamp', px + 6.5, pz - 1, 0, true);
      g.structures.place('lamp', px + 4, pz + 9, 0, true);
      g.structures.place('tesla', px + 1, pz + 7, 0, true);
      g.structures.place('tesla', px + 2, pz - 8, 0, true);
      for (let i = 0; i < 3; i++) g.structures.place('wall', px + 10, pz - 2.2 + i * 2.2, Math.PI, true);
      g.cycle.set('night', 30);
      g.renderer.rig.target.set(px, g.terrain.heightAt(px, pz), pz);
      g.renderer.rig.snap();
    });
    // spawn creatures in an arc to the player's right (angles in radians around +X); tougher than usual so
    // the fight reaches the barricades instead of ending at the edge of the screen
    const spawn = (kinds, r0, r1, spread = 1.2, opts = {}) =>
      ev(
        ([kinds, r0, r1, spread, opts]) => {
          const g = window.__game;
          let n = 0;
          for (let i = 0; n < kinds.length && i < 300; i++) {
            const a = (Math.random() * 2 - 1) * spread;
            const r = r0 + Math.random() * (r1 - r0);
            const x = g.player.x + Math.cos(a) * r;
            const z = g.player.z + Math.sin(a) * r;
            if (g.flowShip.blocked[g.flowShip.idx(x, z)]) continue;
            const kind = kinds[n++];
            const e = g.enemies.spawn(kind, x, z, 'hunt', { night: true, aggro: true, emerge: !!opts.emerge, elite: kind === 'brute' });
            e.hp *= 1.6;
            e.maxHp *= 1.6;
          }
        },
        [kinds, r0, r1, spread, opts],
      );
    // move the cursor toward the nearest visible creature, the way a player tracks targets
    const aim = () =>
      ev(() => {
        const g = window.__game;
        const p = g.player;
        let best = null;
        let bd = 24;
        for (const e of g.enemies.list) {
          if (!e.alive || e.kind === 'nest' || e.kind === 'burrower') continue;
          const d = Math.hypot(e.x - p.x, e.z - p.z);
          if (d < bd) {
            bd = d;
            best = e;
          }
        }
        if (!best) return;
        const v = g.renderer.rig.target.clone().set(best.x, best.y + 0.6, best.z).project(g.renderer.rig.camera);
        const tx = ((v.x + 1) / 2) * innerWidth;
        const ty = ((1 - v.y) / 2) * innerHeight;
        g.input.mouseX += (tx - g.input.mouseX) * 0.5;
        g.input.mouseY += (ty - g.input.mouseY) * 0.5;
      });
    const S = 'skitter';
    await step(1);
    await spawn([S, S, 'spitter', S, S, S, 'floater', S, S, S, 'brute', S, S, 'spitter', S, S], 16, 26);
    await ev(() => {
      const g = window.__game;
      g.input.mouseX = innerWidth * 0.72;
      g.input.mouseY = innerHeight * 0.47;
      g.input.mouseDown = true;
    });
    await step(1.2);
    const E = { emerge: true };
    const waves = {
      0: [[S, S, S, S, 'spitter', S], 18, 26],
      8: [[S, S, S, S], 9, 15, 1.3, E],
      16: [['brute', S, S, S, 'floater'], 18, 24, 0.5],
      26: [[S, S, S, 'spitter', S, S, S], 16, 26],
      34: [['burrower', S, S, S, S], 8, 14, 1.2, E],
      44: [[S, S, S, S, 'spitter', 'floater', S], 16, 26],
      54: [['brute', S, S, S, S], 17, 24, 0.7],
      62: [[S, S, S, S, S], 9, 15, 1.3, E],
      72: [[S, S, S, 'spitter', S, 'floater', S], 16, 26],
      82: [[S, S, S, S, S, 'spitter'], 10, 20, 1.2, E],
      90: [['brute', S, S, S, S, S], 16, 24, 0.9],
    };
    const dry = !!process.env.REEL_DRY;
    for (let f = 0; f < frames; f++) {
      if (waves[f]) await spawn(...waves[f]);
      if (f === 20 || f === 66)
        await ev(() => {
          const g = window.__game;
          g.player.secondaryCd = 0;
          g.input.rightPressed = true;
        });
      await aim();
      await step(1 / fps);
      await ev(() => (window.__game.player.hp = 1e6));
      if (!dry) {
        await shot(`reel/f${String(f).padStart(3, '0')}`);
        continue;
      }
      // REEL_DRY=1: report how close the fight gets instead of rendering frames
      if (f % 10 === 0)
        console.log(
          `f${f}`,
          await ev(() => {
            const g = window.__game;
            const p = g.player;
            let alive = 0;
            let onScreen = 0;
            let near = 0;
            for (const e of g.enemies.list) {
              if (!e.alive) continue;
              alive++;
              const v = g.renderer.rig.target.clone().set(e.x, e.y, e.z).project(g.renderer.rig.camera);
              if (Math.abs(v.x) < 1 && Math.abs(v.y) < 1) onScreen++;
              if (Math.hypot(e.x - p.x, e.z - p.z) < 12) near++;
            }
            return `alive:${alive} onScreen:${onScreen} within12m:${near} kills:${g.record.kills}`;
          }),
        );
    }
    await ev(() => (window.__game.input.mouseDown = false));
    continue;
  }
  if (sc === 'boss') {
    await ensureRun();
    const a = await ev(() => {
      const g = window.__game;
      g.player.hp = 1e6;
      g.cycle.set('day', 40);
      return g.layout.arena;
    });
    await teleport(a.x + 14, a.z + 10);
    await step(0.5);
    await teleport(a.x + 12, a.z + 8);
    await step(4);
    await shot('boss-1');
    await ev(() => (window.__game.input.mouseDown = true));
    await step(5);
    await shot('boss-2');
    await ev(() => (window.__game.input.mouseDown = false));
    continue;
  }
  if (sc === 'ui') {
    await ensureRun();
    await ev(() => {
      const g = window.__game;
      g.inventory.xenite = 60;
      g.inventory.scrap = 90;
      const h = g.ship.hatch();
      g.player.x = h.x;
      g.player.z = h.z;
      g.openFabricator();
    });
    await shot('ui-fabricator');
    await ev(() => window.__game.closeFabricator());
    await ev(() => {
      const g = window.__game;
      g.state = 'map';
      g.screens.toggleMap(true);
    });
    await shot('ui-map');
    await ev(() => {
      const g = window.__game;
      g.screens.toggleMap(false);
      g.state = 'playing';
      g.setPaused(true);
    });
    await shot('ui-pause');
    await ev(() => window.__game.setPaused(false));
    continue;
  }
  if (sc === 'finale') {
    // parts → boss (incl. leash) → reactor → launch → board → outro → victory
    await ensureRun();
    const r1 = await ev(() => {
      const g = window.__game;
      const log = [];
      g.player.hp = 1e9;
      g.ship.hull = 1e7;
      const h = g.ship.hatch();
      for (const id of ['coil', 'cell', 'nav']) {
        const q = g.layout.parts.find((k) => k.id === id);
        g.player.x = q.x;
        g.player.z = q.z;
        g.step(0.4);
        const a = g.partState[id];
        g.player.x = h.x;
        g.player.z = h.z;
        g.step(0.4);
        log.push(`${id}:${a}->${g.partState[id]}`);
      }
      const a = g.layout.arena;
      g.player.x = a.x + 12;
      g.player.z = a.z + 8;
      g.step(4);
      log.push(`boss:${!!g.enemies.boss}`);
      // flee toward the ship: she should leash back home
      const ra = Math.hypot(a.x, a.z);
      g.player.x = a.x * (1 - 75 / ra);
      g.player.z = a.z * (1 - 75 / ra);
      g.step(6);
      const b = g.enemies.boss;
      log.push(`leashed:${b?.leashed} bar:${document.getElementById('boss').classList.contains('show')} bossToArena:${Math.round(Math.hypot(b.x - a.x, b.z - a.z))}`);
      g.player.x = a.x + 14;
      g.player.z = a.z + 8;
      g.step(1);
      log.push(`reengaged:${!g.enemies.boss?.leashed} bar:${document.getElementById('boss').classList.contains('show')}`);
      return log.join(' | ');
    });
    console.log(r1);
    await shot('finale-1-boss');
    const r2 = await ev(() => {
      const g = window.__game;
      const log = [];
      g.enemies.kill(g.enemies.boss, 'test');
      g.step(3);
      const rp = g.partSpots.reactor;
      g.player.x = rp.x;
      g.player.z = rp.z;
      g.step(0.5);
      log.push(`reactor:${g.partState.reactor}`);
      const h = g.ship.hatch();
      g.player.x = h.x;
      g.player.z = h.z;
      g.step(0.5);
      log.push(`installed:${g.ship.installed.length} launching:${g.launching} hull:${Math.round(g.ship.hull)}`);
      g.ship.hull = 1e7;
      g.player.x = h.x + 10;
      g.player.z = h.z + 6;
      g.input.mouseDown = true;
      g.step(40);
      log.push(`t-${Math.round(g.launchRemaining)} enemies:${g.enemies.count} hullLost:${Math.round(1e7 - g.ship.hull)}`);
      return log.join(' | ');
    });
    console.log(r2);
    await shot('finale-2-launch');
    const r3 = await ev(() => {
      const g = window.__game;
      const log = [];
      const h = g.ship.hatch();
      g.player.x = h.x + 40;
      g.player.z = h.z + 30;
      g.step(40);
      log.push(`afterTimer state:${g.state} remaining:${g.launchRemaining.toFixed(1)}`);
      g.input.mouseDown = false;
      g.player.x = h.x;
      g.player.z = h.z;
      g.step(0.5);
      log.push(`boarded state:${g.state}`);
      g.step(3);
      return log.join(' | ');
    });
    console.log(r3);
    await shot('finale-3-outro');
    const r4 = await ev(() => {
      const g = window.__game;
      g.step(6);
      return `state:${g.state}`;
    });
    console.log(r4);
    await wait(2500);
    await shot('finale-4-victory');
    continue;
  }
  if (sc === 'gameover') {
    await page.reload();
    await page.waitForFunction(() => !!window.__game, null, { timeout: 90000 });
    await wait(1500);
    await startRun();
    await step(8);
    const r = await ev(() => {
      const g = window.__game;
      const log = [];
      for (let i = 0; i < 5 && g.state === 'playing'; i++) {
        g.player.iframes = 0;
        g.player.dashT = 0;
        g.player.hurt(1e6, g.player.x + 1, g.player.z, 5, 'skitter');
        g.step(4);
        log.push(`lives:${g.lives} alive:${g.player.alive} state:${g.state}`);
      }
      g.step(3);
      return log.join(' | ');
    });
    console.log(r);
    await wait(2500);
    await shot('gameover');
    continue;
  }
  if (sc === 'soak') {
    // long unattended run: the player wanders and fires; checks for runtime errors
    await ensureRun();
    const t0 = Date.now();
    const res = await ev(() => {
      const g = window.__game;
      g.player.hp = 1e9;
      const out = [];
      for (let i = 0; i < 40; i++) {
        g.input.mouseDown = i % 3 !== 0;
        g.input.mouseX = 400 + ((i * 97) % 800);
        g.input.mouseY = 200 + ((i * 53) % 500);
        g.step(15);
        out.push(`${g.cycle.phase}:${g.enemies.count}`);
      }
      g.input.mouseDown = false;
      return { out: out.join(' '), kills: g.record.kills, state: g.state, day: g.cycle.day };
    });
    console.log('soak', JSON.stringify(res), `${((Date.now() - t0) / 1000).toFixed(1)}s wall`);
    await shot('soak-end');
    continue;
  }
}

console.log('state', await ev(() => ({ state: window.__game.state, enemies: window.__game.enemies.count, hp: Math.round(window.__game.player.hp) })));
console.log('--- errors ---');
console.log(errors.length ? [...new Set(errors)].slice(0, 30).join('\n') : 'none');
await browser.close();
if (errors.length) process.exitCode = 1;
