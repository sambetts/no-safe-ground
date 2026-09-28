import { spawn, spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright-core';

const sfx = ['shoot','shootSpread','overheat','cooled','hit','hitArmor','enemyDie','bigDie','playerHurt','dash','pickupScrap','pickupXenite','pickupHealth','bulbPop','partPickup','install','build','turretShoot','teslaZap','explosion','grenadeThrow','spit','acidSplash','roar','charge','burrow','emerge','sporeRelease','thunder','lightning','geyser','uiClick','uiHover','uiError','uiOpen','uiClose','upgrade','alarm','nightfall','dawn','o2Warning','heartbeat','shipHit','crash','engineRoar','logFound','nestSpawn','shieldBreak','step','bossRoar','mineBeep','victory','defeat'];
const loops = ['wind','breathing','storm','shipHum','fire'];
const moods = ['silent','title','explore','dusk','night','boss','launch','victory','gameover'];

const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5399'], { stdio: ['ignore', 'pipe', 'pipe'] });
let output = '';
server.stdout.on('data', d => { output += d.toString(); });
server.stderr.on('data', d => { output += d.toString(); });

async function waitForServer() {
  for (let i = 0; i < 80; i++) {
    try {
      const res = await fetch('http://127.0.0.1:5399/audio-lab.html');
      if (res.ok) return;
    } catch {}
    await delay(250);
  }
  throw new Error(`Vite did not start. Output:\n${output}`);
}

let browser;
const errors = [];
try {
  await waitForServer();
  browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage();
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', err => errors.push(err.stack || err.message));
  await page.goto('http://127.0.0.1:5399/audio-lab.html', { waitUntil: 'networkidle' });
  await page.evaluate(async ({ sfx, loops, moods }) => {
    const audio = window.__audio;
    audio.unlock();
    audio.setVolumes({ master: 0.4, sfx: 0.7, music: 0.45 });
    audio.setListener(0, 0);
    for (const [i, name] of sfx.entries()) audio.play(name, i % 2 ? { x: (i % 9) * 5 - 20, z: 4, volume: 0.7 } : { volume: 0.7 });
    const handles = loops.map(name => { const h = audio.loop(name); h.setVolume(0.35); return h; });
    for (const mood of moods) {
      audio.setMusic(mood);
      audio.setIntensity(0);
      for (let i = 0; i < 10; i++) audio.update(0.05);
      audio.setIntensity(1);
      for (let i = 0; i < 10; i++) audio.update(0.05);
    }
    audio.setPaused(true); audio.update(0.05); audio.setPaused(false);
    audio.setMuffled(1); audio.update(0.05); audio.setMuffled(0);
    for (const h of handles) h.stop();
    audio.setMusic('silent');
  }, { sfx, loops, moods });
  await page.waitForTimeout(1500);
  if (errors.length) throw new Error(`Browser audio errors:\n${errors.join('\n')}`);
  console.log('audio headless smoke passed');
} finally {
  if (browser) await browser.close().catch(() => {});
  if (server.pid && !server.killed) {
    if (process.platform === 'win32') spawnSync('powershell.exe', ['-NoProfile', '-Command', 'Stop-Process -Id ' + server.pid + ' -Force']);
    else server.kill();
  }
}




