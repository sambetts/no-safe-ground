import { WORLD } from '../config';
import type { Obstacle } from './worldgen';

const HALF = 240;

/** Uniform grid over static circular obstacles (rocks, nodes, the ship, structures). */
export class StaticGrid {
  readonly cell = 4;
  readonly n = Math.ceil((HALF * 2) / 4);
  private cells: Obstacle[][] = [];
  private stamp = 1;

  constructor(obstacles: Obstacle[]) {
    for (let i = 0; i < this.n * this.n; i++) this.cells.push([]);
    for (const o of obstacles) this.add(o);
  }

  private range(x: number, z: number, r: number): [number, number, number, number] {
    const c = this.cell;
    const x0 = Math.max(0, Math.floor((x - r + HALF) / c));
    const x1 = Math.min(this.n - 1, Math.floor((x + r + HALF) / c));
    const z0 = Math.max(0, Math.floor((z - r + HALF) / c));
    const z1 = Math.min(this.n - 1, Math.floor((z + r + HALF) / c));
    return [x0, x1, z0, z1];
  }

  add(o: Obstacle): void {
    const [x0, x1, z0, z1] = this.range(o.x, o.z, o.r);
    for (let j = z0; j <= z1; j++) for (let i = x0; i <= x1; i++) this.cells[j * this.n + i].push(o);
  }

  remove(o: Obstacle): void {
    const [x0, x1, z0, z1] = this.range(o.x, o.z, o.r);
    for (let j = z0; j <= z1; j++)
      for (let i = x0; i <= x1; i++) {
        const arr = this.cells[j * this.n + i];
        const k = arr.indexOf(o);
        if (k >= 0) arr.splice(k, 1);
      }
  }

  /** Calls fn for each alive obstacle whose cell overlaps the circle (each obstacle at most once). */
  query(x: number, z: number, r: number, fn: (o: Obstacle) => void | boolean): void {
    const [x0, x1, z0, z1] = this.range(x, z, r);
    const s = ++this.stamp;
    for (let j = z0; j <= z1; j++)
      for (let i = x0; i <= x1; i++) {
        const arr = this.cells[j * this.n + i];
        for (let k = 0; k < arr.length; k++) {
          const o = arr[k];
          if (!o.alive || o.mark === s) continue;
          o.mark = s;
          if (fn(o) === true) return;
        }
      }
  }

  /** Pushes a circle out of all overlapping obstacles. Returns the last obstacle touched (or null). */
  resolve(p: { x: number; z: number }, r: number): Obstacle | null {
    let hit: Obstacle | null = null;
    for (let iter = 0; iter < 2; iter++) {
      this.query(p.x, p.z, r + 0.1, (o) => {
        const dx = p.x - o.x;
        const dz = p.z - o.z;
        const d2 = dx * dx + dz * dz;
        const min = o.r + r;
        if (d2 < min * min) {
          const d = Math.sqrt(d2) || 0.0001;
          const push = min - d;
          p.x += (dx / d) * push;
          p.z += (dz / d) * push;
          hit = o;
        }
      });
    }
    // world boundary
    const d = Math.sqrt(p.x * p.x + p.z * p.z);
    const maxR = WORLD.radius;
    if (d > maxR) {
      p.x *= maxR / d;
      p.z *= maxR / d;
    }
    return hit;
  }

  /** First obstacle intersected by a moving circle along segment A->B. Returns t in [0,1] or -1. */
  sweep(ax: number, az: number, bx: number, bz: number, r: number, out: { o: Obstacle | null }): number {
    const dx = bx - ax;
    const dz = bz - az;
    const L = Math.sqrt(dx * dx + dz * dz);
    const cx = (ax + bx) / 2;
    const cz = (az + bz) / 2;
    let best = 2;
    out.o = null;
    this.query(cx, cz, L / 2 + r + 0.1, (o) => {
      // ray-circle intersection
      const R = o.r + r;
      const fx = ax - o.x;
      const fz = az - o.z;
      const a = dx * dx + dz * dz;
      if (a < 1e-9) return;
      const b = 2 * (fx * dx + fz * dz);
      const c = fx * fx + fz * fz - R * R;
      if (c < 0) {
        best = 0;
        out.o = o;
        return;
      }
      const disc = b * b - 4 * a * c;
      if (disc < 0) return;
      const t = (-b - Math.sqrt(disc)) / (2 * a);
      if (t >= 0 && t <= 1 && t < best) {
        best = t;
        out.o = o;
      }
    });
    return best <= 1 ? best : -1;
  }

  lineOfSight(ax: number, az: number, bx: number, bz: number, ignoreSmall = 0): boolean {
    const tmp = { o: null as Obstacle | null };
    const t = this.sweep(ax, az, bx, bz, 0, tmp);
    if (t < 0) return true;
    return tmp.o !== null && tmp.o.r < ignoreSmall;
  }
}

/** Generic spatial hash for dynamic entities, rebuilt every frame. */
export class SpatialHash<T extends { x: number; z: number }> {
  readonly cell = 4;
  readonly n = Math.ceil((HALF * 2) / 4);
  private buckets: T[][] = [];
  private used: number[] = [];

  constructor() {
    for (let i = 0; i < this.n * this.n; i++) this.buckets.push([]);
  }

  clear(): void {
    for (const i of this.used) this.buckets[i].length = 0;
    this.used.length = 0;
  }

  insert(item: T): void {
    const i = Math.min(this.n - 1, Math.max(0, Math.floor((item.x + HALF) / this.cell)));
    const j = Math.min(this.n - 1, Math.max(0, Math.floor((item.z + HALF) / this.cell)));
    const idx = j * this.n + i;
    const b = this.buckets[idx];
    if (b.length === 0) this.used.push(idx);
    b.push(item);
  }

  query(x: number, z: number, r: number, out: T[]): T[] {
    out.length = 0;
    const c = this.cell;
    const x0 = Math.max(0, Math.floor((x - r + HALF) / c));
    const x1 = Math.min(this.n - 1, Math.floor((x + r + HALF) / c));
    const z0 = Math.max(0, Math.floor((z - r + HALF) / c));
    const z1 = Math.min(this.n - 1, Math.floor((z + r + HALF) / c));
    for (let j = z0; j <= z1; j++)
      for (let i = x0; i <= x1; i++) {
        const b = this.buckets[j * this.n + i];
        for (let k = 0; k < b.length; k++) out.push(b[k]);
      }
    return out;
  }
}

/**
 * Dijkstra distance field on a 2 m grid. Creatures descend the gradient to reach a target around obstacles.
 * Structures add traversal cost (creatures would rather go around a barricade, but will chew through it).
 */
export class FlowField {
  readonly cell = 2;
  readonly half = 200;
  readonly n = 200;
  readonly blocked: Uint8Array;
  readonly extraCost: Float32Array;
  readonly dist: Float32Array;
  private heap: Int32Array;
  private keys: Float32Array;
  private heapSize = 0;

  constructor(grid: StaticGrid) {
    const N = this.n * this.n;
    this.blocked = new Uint8Array(N);
    this.extraCost = new Float32Array(N);
    this.dist = new Float32Array(N).fill(Infinity);
    this.heap = new Int32Array(N * 2);
    this.keys = new Float32Array(N * 2);
    for (let j = 0; j < this.n; j++)
      for (let i = 0; i < this.n; i++) {
        const x = -this.half + (i + 0.5) * this.cell;
        const z = -this.half + (j + 0.5) * this.cell;
        let b = Math.sqrt(x * x + z * z) > WORLD.radius - 0.5;
        if (!b)
          grid.query(x, z, 3, (o) => {
            if (o.kind === 'node') return;
            const dx = x - o.x;
            const dz = z - o.z;
            if (dx * dx + dz * dz < (o.r + 0.35) * (o.r + 0.35)) {
              b = true;
              return true;
            }
          });
        this.blocked[j * this.n + i] = b ? 1 : 0;
      }
  }

  idx(x: number, z: number): number {
    const i = Math.floor((x + this.half) / this.cell);
    const j = Math.floor((z + this.half) / this.cell);
    if (i < 0 || j < 0 || i >= this.n || j >= this.n) return -1;
    return j * this.n + i;
  }

  setCostCircle(x: number, z: number, r: number, cost: number): void {
    const c = this.cell;
    for (let j = Math.floor((z - r + this.half) / c); j <= Math.floor((z + r + this.half) / c); j++)
      for (let i = Math.floor((x - r + this.half) / c); i <= Math.floor((x + r + this.half) / c); i++) {
        if (i < 0 || j < 0 || i >= this.n || j >= this.n) continue;
        const cx = -this.half + (i + 0.5) * c;
        const cz = -this.half + (j + 0.5) * c;
        if ((cx - x) * (cx - x) + (cz - z) * (cz - z) <= (r + 1) * (r + 1)) this.extraCost[j * this.n + i] = cost;
      }
  }

  // binary min-heap of (cell index, key) with lazy deletion (duplicates allowed, stale entries skipped)
  private push(i: number, d: number): void {
    let k = this.heapSize++;
    if (k >= this.heap.length) {
      const nh = new Int32Array(this.heap.length * 2);
      nh.set(this.heap);
      this.heap = nh;
      const nk = new Float32Array(this.keys.length * 2);
      nk.set(this.keys);
      this.keys = nk;
    }
    const H = this.heap;
    const K = this.keys;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (K[p] <= d) break;
      H[k] = H[p];
      K[k] = K[p];
      k = p;
    }
    H[k] = i;
    K[k] = d;
  }

  private pop(): number {
    const H = this.heap;
    const K = this.keys;
    const top = H[0];
    const n = --this.heapSize;
    if (n > 0) {
      const li = H[n];
      const lk = K[n];
      let k = 0;
      for (;;) {
        const l = 2 * k + 1;
        if (l >= n) break;
        const r = l + 1;
        const m = r < n && K[r] < K[l] ? r : l;
        if (K[m] >= lk) break;
        H[k] = H[m];
        K[k] = K[m];
        k = m;
      }
      H[k] = li;
      K[k] = lk;
    }
    return top;
  }

  /** Computes distances from the given target points, expanding at most maxDist metres. */
  compute(targets: { x: number; z: number }[], maxDist = 1e9): void {
    const n = this.n;
    const D = this.dist;
    D.fill(Infinity);
    this.heapSize = 0;
    const done = new Uint8Array(n * n);
    for (const t of targets) {
      const i = this.idx(t.x, t.z);
      if (i < 0) continue;
      D[i] = 0;
      this.push(i, 0);
    }
    const c = this.cell;
    const diag = c * Math.SQRT2;
    while (this.heapSize > 0) {
      const cur = this.pop();
      if (done[cur]) continue;
      done[cur] = 1;
      const d0 = D[cur];
      if (d0 > maxDist) break;
      const ci = cur % n;
      const cj = (cur - ci) / n;
      for (let dj = -1; dj <= 1; dj++)
        for (let di = -1; di <= 1; di++) {
          if (di === 0 && dj === 0) continue;
          const ni = ci + di;
          const nj = cj + dj;
          if (ni < 0 || nj < 0 || ni >= n || nj >= n) continue;
          const nIdx = nj * n + ni;
          if (this.blocked[nIdx] || done[nIdx]) continue;
          if (di !== 0 && dj !== 0 && (this.blocked[cj * n + ni] || this.blocked[nj * n + ci])) continue;
          const nd = d0 + (di !== 0 && dj !== 0 ? diag : c) + this.extraCost[nIdx];
          if (nd < D[nIdx]) {
            D[nIdx] = nd;
            this.push(nIdx, nd);
          }
        }
    }
  }

  /** Writes the downhill direction at (x,z) into out; returns false if no path is known. */
  dir(x: number, z: number, out: { x: number; z: number }): boolean {
    const n = this.n;
    const i0 = this.idx(x, z);
    if (i0 < 0) return false;
    const D = this.dist;
    let best = D[i0];
    let bi = -1;
    const ci = i0 % n;
    const cj = (i0 - ci) / n;
    for (let dj = -1; dj <= 1; dj++)
      for (let di = -1; di <= 1; di++) {
        if (di === 0 && dj === 0) continue;
        const ni = ci + di;
        const nj = cj + dj;
        if (ni < 0 || nj < 0 || ni >= n || nj >= n) continue;
        const k = nj * n + ni;
        const d = D[k] + (di !== 0 && dj !== 0 ? 0.01 : 0);
        if (d < best) {
          best = d;
          bi = k;
        }
      }
    if (bi < 0) return false;
    const bi_i = bi % n;
    const bi_j = (bi - bi_i) / n;
    const tx = -this.half + (bi_i + 0.5) * this.cell;
    const tz = -this.half + (bi_j + 0.5) * this.cell;
    const dx = tx - x;
    const dz = tz - z;
    const l = Math.sqrt(dx * dx + dz * dz) || 1;
    out.x = dx / l;
    out.z = dz / l;
    return true;
  }

  distAt(x: number, z: number): number {
    const i = this.idx(x, z);
    return i < 0 ? Infinity : this.dist[i];
  }
}
