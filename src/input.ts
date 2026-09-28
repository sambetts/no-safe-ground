export type Action =
  | 'up'
  | 'down'
  | 'left'
  | 'right'
  | 'dash'
  | 'interact'
  | 'pause'
  | 'map'
  | 'build1'
  | 'build2'
  | 'build3'
  | 'build4'
  | 'build5'
  | 'cancel'
  | 'skip';

const KEYMAP: Record<string, Action[]> = {
  KeyW: ['up'],
  ArrowUp: ['up'],
  KeyS: ['down'],
  ArrowDown: ['down'],
  KeyA: ['left'],
  ArrowLeft: ['left'],
  KeyD: ['right'],
  ArrowRight: ['right'],
  Space: ['dash', 'skip'],
  ShiftLeft: ['dash'],
  ShiftRight: ['dash'],
  KeyE: ['interact'],
  KeyF: ['interact'],
  Escape: ['pause', 'cancel'],
  KeyP: ['pause'],
  KeyM: ['map'],
  Tab: ['map'],
  Digit1: ['build1'],
  Digit2: ['build2'],
  Digit3: ['build3'],
  Digit4: ['build4'],
  Digit5: ['build5'],
  KeyQ: ['cancel'],
  Enter: ['skip'],
};

/** Keyboard + mouse + gamepad state with edge-triggered "pressed" flags cleared every frame. */
export class Input {
  private down = new Set<Action>();
  private pressedSet = new Set<Action>();
  mouseX = window.innerWidth / 2;
  mouseY = window.innerHeight / 2;
  mouseDown = false;
  rightDown = false;
  mousePressed = false;
  rightPressed = false;
  wheel = 0;
  anyPressed = false;
  usingGamepad = false;
  // gamepad
  padMoveX = 0;
  padMoveY = 0;
  padAimX = 0;
  padAimY = 0;
  padFire = false;
  private padPrev: boolean[] = [];

  constructor(target: HTMLElement) {
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Tab') e.preventDefault();
      if (e.code === 'Space' && e.target === document.body) e.preventDefault();
      const acts = KEYMAP[e.code];
      this.anyPressed = true;
      this.usingGamepad = false;
      if (!acts) return;
      for (const a of acts) {
        if (!e.repeat) this.pressedSet.add(a);
        this.down.add(a);
      }
    });
    window.addEventListener('keyup', (e) => {
      const acts = KEYMAP[e.code];
      if (!acts) return;
      for (const a of acts) this.down.delete(a);
    });
    window.addEventListener('blur', () => {
      this.down.clear();
      this.mouseDown = false;
      this.rightDown = false;
    });
    window.addEventListener('mousemove', (e) => {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
      this.usingGamepad = false;
    });
    target.addEventListener('mousedown', (e) => {
      this.anyPressed = true;
      this.usingGamepad = false;
      if (e.button === 0) {
        this.mouseDown = true;
        this.mousePressed = true;
      } else if (e.button === 2) {
        this.rightDown = true;
        this.rightPressed = true;
      }
    });
    window.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseDown = false;
      else if (e.button === 2) this.rightDown = false;
    });
    target.addEventListener('contextmenu', (e) => e.preventDefault());
    target.addEventListener(
      'wheel',
      (e) => {
        this.wheel += Math.sign(e.deltaY);
      },
      { passive: true },
    );
  }

  isDown(a: Action): boolean {
    return this.down.has(a);
  }

  pressed(a: Action): boolean {
    return this.pressedSet.has(a);
  }

  /** Movement vector in screen space (x right, y down), length <= 1. */
  move(): { x: number; y: number } {
    let x = 0;
    let y = 0;
    if (this.down.has('left')) x -= 1;
    if (this.down.has('right')) x += 1;
    if (this.down.has('up')) y -= 1;
    if (this.down.has('down')) y += 1;
    if (Math.abs(this.padMoveX) > 0.18 || Math.abs(this.padMoveY) > 0.18) {
      x = this.padMoveX;
      y = this.padMoveY;
    }
    const l = Math.hypot(x, y);
    if (l > 1) {
      x /= l;
      y /= l;
    }
    return { x, y };
  }

  pollGamepad(): void {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = pads && pads[0];
    if (!gp) return;
    const dz = (v: number) => (Math.abs(v) < 0.15 ? 0 : v);
    this.padMoveX = dz(gp.axes[0] ?? 0);
    this.padMoveY = dz(gp.axes[1] ?? 0);
    this.padAimX = dz(gp.axes[2] ?? 0);
    this.padAimY = dz(gp.axes[3] ?? 0);
    const btn = (i: number) => !!gp.buttons[i]?.pressed;
    const edge = (i: number) => btn(i) && !this.padPrev[i];
    if (this.padMoveX || this.padMoveY || this.padAimX || this.padAimY) this.usingGamepad = true;
    this.padFire = btn(7) || (gp.buttons[7]?.value ?? 0) > 0.3;
    if (this.padFire) this.usingGamepad = true;
    if (edge(0) || edge(4)) this.pressedSet.add('dash');
    if (edge(0)) this.pressedSet.add('skip');
    if (edge(2)) this.pressedSet.add('interact');
    if (edge(9)) this.pressedSet.add('pause');
    if (edge(1)) this.pressedSet.add('cancel');
    if (edge(8)) this.pressedSet.add('map');
    if (edge(6) || edge(5)) {
      this.rightPressed = true;
    }
    this.rightDown = this.rightDown || btn(6) || btn(5);
    if (edge(12)) this.pressedSet.add('build1');
    if (edge(15)) this.pressedSet.add('build2');
    if (edge(13)) this.pressedSet.add('build3');
    if (edge(14)) this.pressedSet.add('build4');
    for (let i = 0; i < gp.buttons.length; i++) {
      if (edge(i)) this.anyPressed = true;
      this.padPrev[i] = btn(i);
    }
  }

  endFrame(): void {
    this.pressedSet.clear();
    this.mousePressed = false;
    this.rightPressed = false;
    this.wheel = 0;
    this.anyPressed = false;
  }
}
