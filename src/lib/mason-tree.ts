import createTree, { Tree } from "functional-red-black-tree";

// ─── Types ────────────────────────────────────────────────────────────────────

export type Axis = "x" | "y";
export type Direction = "positive" | "negative";

export interface RectInit {
  id?: unknown;
  x?: number;
  y?: number;
  width?: number;
  w?: number;
  height?: number;
  h?: number;
  /** Per-rect margin that overrides the tree's global gap (largest wins). */
  margin?: number;
}

export interface ObstructionResult {
  negative: number;
  positive: number;
}

export interface PullOptions {
  pullX?: boolean;
  pullY?: boolean;
  /** Bias in [-1, 1]. -1 = left/top wall, 0 = centre, +1 = right/bottom wall. */
  pullXValue?: number;
  pullYValue?: number;
  stickyLeftWall?: boolean;
  stickyTopWall?: boolean;
  stickyRightWall?: boolean;
  stickyBottomWall?: boolean;
}

// ─── Internal ─────────────────────────────────────────────────────────────────

type RectTree = Tree<number, Rect>;
type AxisIndex = {
  bst: Tree<number, RectTree>;
  frequencies: Record<number, number>;
};
type Point = { x: number; y: number };

function opp(axis: Axis): Axis {
  return axis === "x" ? "y" : "x";
}
function maxKey(axis: Axis): "maxX" | "maxY" {
  return axis === "x" ? "maxX" : "maxY";
}
function sizeKey(axis: Axis): "w" | "h" {
  return axis === "x" ? "w" : "h";
}

// ─── Rect ─────────────────────────────────────────────────────────────────────

export class Rect {
  constructor(
    public x: number,
    public y: number,
    public w: number,
    public h: number,
    public id: unknown = 0,
    public margin: number = 0,
  ) {}

  get maxX(): number {
    return this.x + this.w;
  }
  get maxY(): number {
    return this.y + this.h;
  }
  get center(): { x: number; y: number } {
    return { x: this.x + this.w / 2, y: this.y + this.h / 2 };
  }
}

// ─── MasonTree ────────────────────────────────────────────────────────────────

export class MasonTree {
  readonly rects = new Map<unknown, Rect>();

  // Width is fixed at construction. Height starts at 0 and grows as rects
  // are packed; after addRect() it equals Math.max(...placed.maxY).
  // iterativelyAdjust() respects this as the positive-Y wall.
  readonly container: Rect;

  get width(): number {
    return this.container.w;
  }
  get height(): number {
    return this.container.h;
  }

  private ax: AxisIndex = { bst: createTree(), frequencies: {} };
  private ay: AxisIndex = { bst: createTree(), frequencies: {} };

  private insertionPoints: Tree<Point, undefined> = (
    createTree((a: Point, b: Point) => a.y - b.y || a.x - b.x) as Tree<
      Point,
      undefined
    >
  ).insert({ x: 0, y: 0 }, undefined);

  /**
   * @param containerWidth  Fixed container width in px.
   * @param defaultGap      Global gap applied between all rects. Per-rect margin
   *                        overrides this (largest wins, margin-collapse style).
   */
  constructor(
    containerWidth: number,
    public defaultGap: number = 0,
  ) {
    this.container = new Rect(0, 0, Math.max(1, Math.round(containerWidth)), 0);
    this.getOrCreateSlab("x", 0);
    this.getOrCreateSlab("y", 0);
  }

  // ── Pack ──────────────────────────────────────────────────────────────────────

  addRect(...inits: RectInit[]): this {
    for (const init of inits) {
      const w = Math.max(0, Math.round(init.width ?? init.w ?? 0));
      const h = Math.max(0, Math.round(init.height ?? init.h ?? 0));
      if (w === 0 || h === 0) continue;
      const margin = init.margin ?? this.defaultGap;
      this.pack(new Rect(0, 0, w, h, init.id ?? this.rects.size, margin));
    }
    return this;
  }

  private pack(rect: Rect): void {
    const iter = this.insertionPoints.begin;
    while (iter.valid) {
      const pt = iter.key!;

      // X: bounded by container width; margin-aware.
      const obsX = this.obstructions(
        new Rect(pt.x, pt.y, 0, rect.h, undefined, rect.margin),
        "x",
        "negative",
        "positive",
      );
      const x = obsX.negative;

      if (x + rect.w <= obsX.positive) {
        // Y: unbounded below during packing (only placed rects block); margin-aware.
        const obsY = this.obstructions(
          new Rect(x, pt.y, rect.w, 0, undefined, rect.margin),
          "y",
          "negative",
          "positive",
          /* packingPass */ true,
        );
        const y = obsY.negative;

        if (y + rect.h <= obsY.positive) {
          rect.x = x;
          rect.y = y;
          this.rects.set(rect.id, rect);
          this.indexRect(rect, "x");
          this.indexRect(rect, "y");
          this.insertionPoints = this.insertionPoints
            .remove(pt)
            .insert({ x: rect.maxX, y: rect.y }, undefined)
            .insert({ x: rect.x, y: rect.maxY }, undefined);
          this.container.h = Math.max(this.container.h, rect.maxY);
          return;
        }
      }
      iter.next();
    }
  }

  // ── Obstruction query ─────────────────────────────────────────────────────────
  //
  // `rect.margin` is the querying rect's own margin.
  //
  // For each found neighbour the effective gap is:
  //   max(rect.margin, neighbour.margin)   ← margin collapse, largest wins
  //
  // Container walls contribute zero margin — rects may sit flush with edges.
  //
  // packingPass = true  → positive-Y bound is Infinity (height is unbounded)
  // packingPass = false → positive-Y bound is container.h

  obstructions(
    rect: Rect,
    axis: Axis,
    ...rest: [...Direction[], boolean] | Direction[]
  ): ObstructionResult {
    let dirs: Direction[];
    let packingPass: boolean;
    if (typeof rest[rest.length - 1] === "boolean") {
      packingPass = rest[rest.length - 1] as boolean;
      dirs = rest.slice(0, -1) as Direction[];
    } else {
      packingPass = false;
      dirs = rest as Direction[];
    }

    const oppAxis = opp(axis);
    const maxA = maxKey(axis);
    const maxOpp = maxKey(oppAxis);
    const myMargin = rect.margin;

    const positiveBound =
      axis === "y" && packingPass ? Infinity : this.container[maxA];

    const result: ObstructionResult = {
      negative: this.container[axis], // wall: zero margin
      positive: positiveBound, // wall: zero margin
    };

    const wantNeg = dirs.includes("negative");
    const wantPos = dirs.includes("positive");

    const idx = axis === "x" ? this.ay : this.ax;
    const it = idx.bst.le(rect[oppAxis]);

    while (it.valid) {
      const { key, value: inner } = it;
      if (key! >= rect[maxOpp]) break;

      if (wantNeg) {
        // Find the nearest rect whose axis-max is to the left/above the probe.
        const l = inner!.lt(rect[axis]);
        if (l.valid) {
          const neighbour = l.value!;
          const gap = Math.max(myMargin, neighbour.margin);
          // The nearest clear position to us is neighbour.maxAxis + gap
          result.negative = Math.max(result.negative, neighbour[maxA] + gap);
        }
      }

      if (wantPos) {
        // Find the nearest rect whose axis-min is to the right/below the probe.
        const r = inner!.ge(rect[maxA]);
        if (r.valid) {
          const neighbour = r.value!;
          const gap = Math.max(myMargin, neighbour.margin);
          // The rightmost position we can reach before hitting this neighbour
          // is neighbour.axis - gap.
          result.positive = Math.min(result.positive, neighbour[axis] - gap);
        }
      }

      it.next();
    }
    return result;
  }

  // ── Iterative repositioning ───────────────────────────────────────────────────

  iterativelyAdjust(
    iterations = 8,
    opts?: PullOptions | ((id: unknown) => PullOptions),
  ): this {
    const defaults: Required<PullOptions> = {
      pullX: true,
      pullY: true,
      pullXValue: 0,
      pullYValue: 0,
      stickyLeftWall: false,
      stickyTopWall: false,
      stickyRightWall: false,
      stickyBottomWall: false,
    };

    for (let i = 0; i < iterations; i++) {
      for (const [id, rect] of this.rects) {
        const o = {
          ...defaults,
          ...(typeof opts === "function" ? opts(id) : opts),
        };
        if (o.pullX)
          this.pull(
            rect,
            "x",
            o.pullXValue,
            !!o.stickyLeftWall,
            !!o.stickyRightWall,
          );
        if (o.pullY)
          this.pull(
            rect,
            "y",
            o.pullYValue,
            !!o.stickyTopWall,
            !!o.stickyBottomWall,
          );
      }
    }
    return this;
  }

  pull(
    rect: Rect,
    axis: Axis,
    direction: number = 0,
    prefNeg: boolean = false,
    prefPos: boolean = false,
  ): boolean {
    const size = rect[sizeKey(axis)];
    const maxA = maxKey(axis);
    const needN = direction !== 1;
    const needP = direction !== -1;
    const dirs = ([needN && "negative", needP && "positive"] as const).filter(
      Boolean,
    ) as Direction[];

    const obs = this.obstructions(rect, axis, ...dirs);

    let pos: number;
    if (direction === 1) {
      pos = obs.positive - size;
    } else if (direction === -1) {
      pos = obs.negative;
    } else {
      const ratio = (direction + 1) / 2;
      const available = obs.positive - obs.negative;
      pos = Math.max(
        obs.negative,
        Math.min(
          obs.positive - size,
          obs.negative + (available - size) * ratio,
        ),
      );
    }

    const atNeg = obs.negative === this.container[axis];
    const atPos = obs.positive === this.container[maxA];

    if (prefNeg && prefPos && atNeg && atPos) {
      pos = this.container[axis] + (this.container[maxA] - size) / 2;
    } else {
      if (
        prefNeg &&
        needN &&
        atNeg &&
        (!atPos ||
          rect[axis] - this.container[axis] < this.container[maxA] - rect[maxA])
      ) {
        pos = this.container[axis];
      }
      if (prefPos && needP && atPos && this.container[axis] !== rect[axis]) {
        pos = this.container[maxA] - size;
      }
    }

    pos = Math.max(
      this.container[axis],
      Math.min(this.container[maxA] - size, Math.round(pos)),
    );
    if (pos === rect[axis]) return false;

    this.translate(rect, axis, pos);
    return true;
  }

  translate(rect: Rect, axis: Axis, newPos: number): void {
    this.translateParallel(rect, axis, newPos);
    this.translatePerpendicular(rect, axis, newPos);

    const size = rect[sizeKey(axis)];
    const idx = this.index(axis);
    const freq = idx.frequencies;
    const oldPos = rect[axis];
    const oldMax = oldPos + size;
    const newMax = newPos + size;

    freq[newPos] = (freq[newPos] ?? 0) + 1;
    freq[newMax] = (freq[newMax] ?? 0) + 1;
    this.decrementFreq(axis, oldPos, freq);
    this.decrementFreq(axis, oldMax, freq);

    rect[axis] = newPos;

    if (freq[newPos] === 1) this.populateSlab(axis, newPos);
    if (freq[newMax] === 1) this.populateSlab(axis, newMax);

    const oppAxis = opp(axis);
    const maxSlab = idx.bst.get(newMax);
    if (maxSlab && maxSlab.get(rect[oppAxis]) === rect) {
      idx.bst = idx.bst
        .remove(newMax)
        .insert(newMax, maxSlab.remove(rect[oppAxis]));
    }
  }

  // ── Index internals ───────────────────────────────────────────────────────────

  private index(axis: Axis): AxisIndex {
    return axis === "x" ? this.ax : this.ay;
  }

  private getOrCreateSlab(axis: Axis, val: number): RectTree {
    const idx = this.index(axis);
    const existing = idx.bst.get(val);
    if (existing) return existing;
    const fresh: RectTree = createTree();
    idx.bst = idx.bst.insert(val, fresh);
    return fresh;
  }

  private populateSlab(axis: Axis, pos: number): void {
    const idx = this.index(axis);
    const maxA = maxKey(axis);
    const oppAxis = opp(axis);

    let slab = idx.bst.get(pos);
    if (!slab) return;

    const prev = idx.bst.lt(pos);
    if (!prev.valid) return;

    const inner = prev.value!.begin;
    while (inner.valid) {
      const rect = inner.value!;
      if (rect[maxA] > pos && !slab.get(rect[oppAxis])) {
        slab = slab.insert(rect[oppAxis], rect);
        idx.bst = idx.bst.remove(pos).insert(pos, slab);
      }
      inner.next();
    }
  }

  private indexRect(rect: Rect, axis: Axis): void {
    const idx = this.index(axis);
    const oppAxis = opp(axis);
    const maxA = maxKey(axis);
    const pos = rect[axis];
    const posMax = rect[maxA];

    for (const val of [pos, posMax]) {
      this.getOrCreateSlab(axis, val);
      idx.frequencies[val] = (idx.frequencies[val] ?? 0) + 1;
      if (idx.frequencies[val] === 1) this.populateSlab(axis, val);
    }

    let it = idx.bst.find(pos);
    while (it.valid) {
      const { key, value } = it;
      if (key! >= posMax) break;
      idx.bst = it.update(value!.insert(rect[oppAxis], rect));
      it = idx.bst.gt(key!);
    }
  }

  private translateParallel(rect: Rect, axis: Axis, newPos: number): void {
    const oppAxis = opp(axis);
    const maxOpp = maxKey(oppAxis);
    const idx = this.index(oppAxis);
    let it = idx.bst.find(rect[oppAxis]);

    while (it.valid) {
      const { key, value } = it;
      if (key! >= rect[maxOpp]) break;
      const without = value!.remove(rect[axis]);
      if (without.get(newPos)) {
        it.next();
        continue;
      }
      idx.bst = it.remove().insert(key!, without.insert(newPos, rect));
      it = idx.bst.gt(key!);
    }
  }

  private translatePerpendicular(rect: Rect, axis: Axis, newPos: number): void {
    const idx = this.index(axis);
    const oppAxis = opp(axis);
    const size = rect[sizeKey(axis)];
    const newMax = newPos + size;
    const maxA = maxKey(axis);

    this.getOrCreateSlab(axis, newPos);
    this.getOrCreateSlab(axis, newMax);

    let it = idx.bst.find(rect[axis]);
    while (it.valid) {
      const { key, value } = it;
      if (key! >= rect[maxA]) break;
      idx.bst = it.update(value!.remove(rect[oppAxis]));
      it = idx.bst.gt(key!);
    }

    it = idx.bst.find(newPos);
    while (it.valid) {
      const { key, value } = it;
      if (key! >= newMax) break;
      idx.bst = it.update(value!.insert(rect[oppAxis], rect));
      it = idx.bst.gt(key!);
    }
  }

  private decrementFreq(
    axis: Axis,
    pos: number,
    freq: Record<number, number>,
  ): void {
    freq[pos]--;
    if (freq[pos] === 0) {
      delete freq[pos];
      if (pos !== 0) this.index(axis).bst = this.index(axis).bst.remove(pos);
    }
  }
}
