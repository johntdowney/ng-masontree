import createTree, { Tree } from 'functional-red-black-tree';

// ─── Primitive types ──────────────────────────────────────────────────────────

export type Axis      = 'x' | 'y';
export type Direction = 'positive' | 'negative';

export interface RectInit {
  id?:     unknown;
  x:       number;
  y:       number;
  width?:  number;
  w?:      number;
  height?: number;
  h?:      number;
}

export interface ObstructionResult {
  negative: number;
  positive: number;
}

// ─── Internal index types (not exported — consumers use MasonTree's API) ──────

type RectTree  = Tree<number, Rect>;
type AxisIndex = { bst: Tree<number, RectTree>; frequencies: Record<number, number> };
type Point     = { x: number; y: number };

// ─── Rect ─────────────────────────────────────────────────────────────────────

export class Rect {
  id: unknown;
  x:  number;
  y:  number;
  w:  number;
  h:  number;

  constructor(init: RectInit) {
    this.id = init.id ?? 0;
    this.x  = init.x;
    this.y  = init.y;
    this.w  = Math.max(0, init.width  ?? init.w  ?? 0);
    this.h  = Math.max(0, init.height ?? init.h  ?? 0);
  }

  get maxX(): number { return this.x + this.w; }
  get maxY(): number { return this.y + this.h; }
  get center(): { x: number; y: number } { return { x: this.x + this.w / 2, y: this.y + this.h / 2 }; }

  toString(): string {
    return `Rect#${String(this.id)} top-bottom: ${this.y}-${this.maxY}, left-right: ${this.x}-${this.maxX}`;
  }
}

// ─── MasonTree ────────────────────────────────────────────────────────────────

export class MasonTree {
  // ── Public ─────────────────────────────────────────────────────────────────
  readonly rects     = new Map<unknown, Rect>();
  container: Rect;

  get width():  number { return this.container.w; }
  get height(): number { return this.container.h; }

  // ── Protected (mixin-accessible) ───────────────────────────────────────────
  x: AxisIndex = { bst: createTree(), frequencies: {} };
  y: AxisIndex = { bst: createTree(), frequencies: {} };

  // ── Private ────────────────────────────────────────────────────────────────
  readonly validator: (tree: MasonTree) => boolean;

  // ─────────────────────────────────────────────────────────────────────────

  constructor(
    public maxContainerWidth:  number,
    public maxContainerHeight: number = Number.MAX_VALUE,
    validator?: (tree: MasonTree) => boolean,
  ) {
    this.validator = validator ?? (() => true);
    this.container = new Rect({ x: 0, y: 0, w: maxContainerWidth, h: maxContainerHeight });

    this.getOrCreateSubTree('x', 0);
    this.getOrCreateSubTree('y', 0);
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  addRect(...rects: RectInit[]): this {
    for (const init of rects) {
      const w  = Math.max(0, Math.round(init.width  ?? init.w  ?? 0));
      const h  = Math.max(0, Math.round(init.height ?? init.h  ?? 0));
      if (w === 0 || h === 0) continue;

      const rect = new Rect({ id: init.id, x: 0, y: 0, w, h });
      this._pack(rect);
    }
    return this;
  }

  calculateNearestAxisObstructions(
    rect: Rect,
    axis: Axis,
    ...directions: Direction[]
  ): ObstructionResult {
    if (directions.length === 0) {
      throw new Error('At least one direction is required.');
    }

    const result: ObstructionResult = {
      negative: this.container[axis],
      positive: this.container[axis === 'x' ? 'maxX' : 'maxY'],
    };

    const opp    = axis === 'x' ? 'y' : 'x';
    const maxA   = axis === 'x' ? 'maxX' : 'maxY';
    const maxOpp = opp  === 'x' ? 'maxX' : 'maxY';

    const wantNeg = directions.includes('negative');
    const wantPos = directions.includes('positive');

    const iter = this[opp].bst.le(rect[opp]);
    while (iter.valid) {
      const { key, value: inner } = iter;
      if (key >= rect[maxOpp]) break;

      if (wantNeg) {
        const it = inner.lt(rect[axis]);
        if (it.valid) result.negative = Math.max(result.negative, it.value![maxA]);
      }
      if (wantPos) {
        const it = inner.ge(rect[maxA]);
        if (it.valid) result.positive = Math.min(result.positive, it.key!);
      }

      iter.next();
    }
    return result;
  }

  // ── Protected (mixin-accessible index mutations) ────────────────────────────

  getOrCreateSubTree(axis: Axis, val: number): RectTree {
    const existing = this[axis].bst.get(val);
    if (existing) return existing;
    const fresh: RectTree = createTree();
    this[axis].bst = this[axis].bst.insert(val, fresh);
    return fresh;
  }

  populateSubTree(axis: Axis, axisPosition: number): void {
    const opp  = axis === 'x' ? 'y' : 'x';
    const maxA = axis === 'x' ? 'maxX' : 'maxY';

    let slab = this[axis].bst.get(axisPosition);
    if (!slab) return;

    const prev = this[axis].bst.lt(axisPosition);
    if (!prev.valid) return;

    const inner = prev.value!.begin;
    while (inner.valid) {
      const rect = inner.value!;
      if (rect[maxA] > axisPosition && !slab.get(rect[opp])) {
        slab = slab.insert(rect[opp], rect);
        this[axis].bst = this[axis].bst.remove(axisPosition).insert(axisPosition, slab);
      }
      inner.next();
    }
  }

  insertRectIntoAxis(rect: Rect, axis: Axis): void {
    const opp    = axis === 'x' ? 'y' : 'x';
    const maxA   = axis === 'x' ? 'maxX' : 'maxY';
    const pos    = rect[axis];
    const posMax = rect[maxA];
    const freq   = this[axis].frequencies;

    for (const val of [pos, posMax]) {
      this.getOrCreateSubTree(axis, val);
      freq[val] = (freq[val] ?? 0) + 1;
      if (freq[val] === 1) this.populateSubTree(axis, val);
    }

    let iter = this[axis].bst.find(pos);
    while (iter.valid) {
      const { key, value } = iter;
      if (key >= posMax) break;
      this[axis].bst = iter.update(value.insert(rect[opp], rect));
      iter = this[axis].bst.gt(key);
    }
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  insertionPoints: Tree<Point, undefined> =
    (createTree((a: Point, b: Point) => a.y - b.y || a.x - b.x) as Tree<Point, undefined>)
      .insert({ x: 0, y: 0 }, undefined);

  _pack(rect: Rect): void {
    const iter = this.insertionPoints.begin;
    while (iter.valid) {
      const point = iter.key!;

      const obsX = this.calculateNearestAxisObstructions(
        new Rect({ x: point.x, y: point.y, w: 0, h: rect.h }),
        'x', 'positive', 'negative',
      );
      const snappedX = obsX.negative;

      if (snappedX + rect.w <= obsX.positive) {
        const obsY = this.calculateNearestAxisObstructions(
          new Rect({ x: snappedX, y: point.y, w: rect.w, h: 0 }),
          'y', 'positive', 'negative',
        );
        const snappedY = obsY.negative;

        if (snappedY + rect.h <= obsY.positive) {
          rect.x = snappedX;
          rect.y = snappedY;
          this.rects.set(rect.id, rect);
          this.insertRectIntoAxis(rect, 'x');
          this.insertRectIntoAxis(rect, 'y');
          this.validator(this);

          this.insertionPoints = this.insertionPoints
            .remove(point)
            .insert({ x: rect.maxX, y: rect.y   }, undefined)
            .insert({ x: rect.x,   y: rect.maxY }, undefined);

          this.container.h = Math.max(this.container.h, rect.maxY);
          return;
        }
      }
      iter.next();
    }
  }
}
