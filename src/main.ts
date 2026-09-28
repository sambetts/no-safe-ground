import './ui/style.css';
import { Game } from './game';

const loading = document.createElement('div');
loading.className = 'loading';
loading.textContent = 'ENTERING ORBIT';
document.body.appendChild(loading);

// Let the loading text paint before the (synchronous) world generation starts.
requestAnimationFrame(() =>
  setTimeout(() => {
    const game = new Game(document.getElementById('app')!);
    (window as unknown as { __game: Game }).__game = game;
    let last = performance.now();
    const frame = (now: number) => {
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      game.update(dt);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
    loading.style.opacity = '0';
    setTimeout(() => loading.remove(), 900);
  }, 30),
);
