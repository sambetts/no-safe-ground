import { audio, type LoopHandle, type LoopName, type MusicMood, type SfxName } from './audio';

declare global {
  interface Window {
    __audio: typeof audio;
  }
}

window.__audio = audio;

const sfxNames: readonly SfxName[] = [
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

const loopNames: readonly LoopName[] = ['wind', 'breathing', 'storm', 'shipHum', 'fire'];
const moods: readonly MusicMood[] = ['silent', 'title', 'explore', 'dusk', 'night', 'boss', 'launch', 'victory', 'gameover'];

const app = document.querySelector<HTMLElement>('#app');
if (!app) throw new Error('Audio lab root missing');

const positional = checkbox('Random positional SFX', false);
const volumeRows = document.createElement('section');
volumeRows.innerHTML = '<h2>Mix</h2>';
volumeRows.append(
  positional,
  slider('Master', 0.8, (value) => audio.setVolumes({ master: value })),
  slider('SFX', 0.9, (value) => audio.setVolumes({ sfx: value })),
  slider('Music', 0.6, (value) => audio.setVolumes({ music: value })),
  slider('Intensity', 0, (value) => audio.setIntensity(value)),
  slider('Muffled', 0, (value) => audio.setMuffled(value)),
);
app.append(volumeRows);

const sfxSection = section('SFX');
const sfxGrid = grid();
for (const name of sfxNames) {
  const sfxButton = button(name, () => {
    audio.unlock();
    const x = positional.input.checked ? Math.random() * 80 - 40 : undefined;
    audio.play(name, x === undefined ? undefined : { x, z: Math.random() * 16 - 8 });
  });
  sfxGrid.append(sfxButton);
}
sfxSection.append(sfxGrid);
app.append(sfxSection);

const musicSection = section('Music');
const musicGrid = grid();
for (const mood of moods) {
  musicGrid.append(button(mood, () => {
    audio.unlock();
    audio.setMusic(mood);
  }));
}
musicSection.append(musicGrid);
app.append(musicSection);

const loopSection = section('Loops');
const activeLoops = new Map<LoopName, LoopHandle>();
for (const name of loopNames) {
  const loopCheckbox = checkbox(name, false);
  loopCheckbox.input.addEventListener('change', () => {
    audio.unlock();

    if (loopCheckbox.input.checked) {
      const handle = audio.loop(name);
      handle.setVolume(0.8);
      activeLoops.set(name, handle);
    } else {
      activeLoops.get(name)?.stop();
      activeLoops.delete(name);
    }
  });
  loopSection.append(loopCheckbox);
}
app.append(loopSection);

window.addEventListener('pointerdown', () => audio.unlock(), { once: true });

let last = performance.now();
function tick(now: number): void {
  audio.update(Math.min(0.1, (now - last) / 1000));
  last = now;
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);

function section(title: string): HTMLElement {
  const element = document.createElement('section');
  const heading = document.createElement('h2');
  heading.textContent = title;
  element.append(heading);
  return element;
}

function grid(): HTMLElement {
  const element = document.createElement('div');
  element.className = 'grid';
  return element;
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const element = document.createElement('button');
  element.textContent = label;
  element.addEventListener('click', onClick);
  return element;
}

function checkbox(label: string, checked: boolean): HTMLLabelElement & { input: HTMLInputElement } {
  const wrap = document.createElement('label') as HTMLLabelElement & { input: HTMLInputElement };
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = checked;
  wrap.input = input;
  wrap.append(input, document.createTextNode(label));
  return wrap;
}

function slider(label: string, value: number, onInput: (value: number) => void): HTMLLabelElement {
  const wrap = document.createElement('label');
  const input = document.createElement('input');
  input.type = 'range';
  input.min = '0';
  input.max = '1';
  input.step = '0.01';
  input.value = String(value);
  input.addEventListener('input', () => onInput(Number(input.value)));
  wrap.append(document.createTextNode(label), input);
  return wrap;
}
