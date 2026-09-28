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
  await draw();
  await draw();
  await page.screenshot({ path: `screenshots/${name}.png` });
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
        return { x: q.x, z: q.z };
      }, id);
      await teleport(p.x + 9, p.z + 9);
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
      const rp = g.layout.parts.find((k) => k.id === 'reactor');
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
