import { MasonTree, Rect, Axis, Direction, RectInit } from './mason-tree';

// ─── Types ────────────────────────────────────────────────────────────────────

/** A bias value in [-1, 1].  -1 = full negative edge, 0 = centre, +1 = full positive edge. */
export type PullDirection = number;

export interface PullOptions {
  /** Pull along X. @default true */
  pullX?:           boolean;
  /** Pull along Y. @default true */
  pullY?:           boolean;
  /** X bias in [-1, 1]. @default 0 */
  pullXValue?:      PullDirection;
  /** Y bias in [-1, 1]. @default 0 */
  pullYValue?:      PullDirection;
  stickyLeftWall?:  boolean;
  stickyTopWall?:   boolean;
  stickyRightWall?: boolean;
  stickyBottomWall?: boolean;
}

export type PullOptionsResolver = (id: unknown) => PullOptions;

const DEFAULTS: Required<PullOptions> = {
  pullX:            true,
  pullY:            true,
  pullXValue:       0,
  pullYValue:       0,
  stickyLeftWall:   false,
  stickyTopWall:    false,
  stickyRightWall:  false,
  stickyBottomWall: false,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resolve(opts: PullOptions | PullOptionsResolver | undefined, id: unknown): Required<PullOptions> {
  const raw = typeof opts === 'function' ? opts(id) : (opts ?? {});
  return { ...DEFAULTS, ...raw };
}

function sizeOf(axis: Axis): 'w' | 'h' { return axis === 'x' ? 'w' : 'h'; }
function maxOf(axis: Axis):  'maxX' | 'maxY' { return axis === 'x' ? 'maxX' : 'maxY'; }
function opp(axis: Axis):    Axis { return axis === 'x' ? 'y' : 'x'; }

// ─── Mixin ────────────────────────────────────────────────────────────────────

type MasonTreeCtor = new (...args: any[]) => MasonTree;

/**
 * Mixin that adds iterative layout-adjustment methods to any MasonTree subclass.
 *
 * @example
 * export class MasonTreeWithLayout extends LayoutMixin(MasonTree) {}
 */
export function LayoutMixin<TBase extends MasonTreeCtor>(Base: TBase) {
  return class extends Base {

    // ── Public API ────────────────────────────────────────────────────────────

    /**
     * Run `iterations` passes over every rectangle, nudging each toward its
     * target position without creating overlaps.
     */
    iterativelyAdjustRectangles(
      iterations = 8,
      opts?: PullOptions | PullOptionsResolver,
    ): ReadonlyMap<unknown, Rect> {
      for (let i = 0; i < iterations; i++) {
        for (const [id, rect] of this.rects) {
          const o = resolve(opts, id);
          if (o.pullX) this.pullRectangle(rect, 'x', o.pullXValue, !!o.stickyLeftWall,  !!o.stickyRightWall);
          if (o.pullY) this.pullRectangle(rect, 'y', o.pullYValue, !!o.stickyTopWall,   !!o.stickyBottomWall);
        }
      }
      return this.rects;
    }

    /**
     * Move `rect` along `axis` toward `direction`, stopping at the nearest
     * obstruction.  Returns `true` if the rect moved.
     */
    pullRectangle(
      rect:            Rect,
      axis:            Axis,
      direction:       PullDirection = 0,
      preferWallNeg  = true,
      preferWallPos  = true,
    ): boolean {
      const size  = rect[sizeOf(axis)];
      const maxA  = maxOf(axis);
      const needN = direction !== 1;
      const needP = direction !== -1;
      const dirs  = ([needN && 'negative', needP && 'positive'] as const).filter(Boolean) as Direction[];

      const obs = this.calculateNearestAxisObstructions(rect, axis, ...dirs);

      let pos: number;
      if      (direction ===  1) { pos = obs.positive - size; }
      else if (direction === -1) { pos = obs.negative; }
      else {
        const ratio = (direction + 1) / 2;
        const gap   = obs.positive - obs.negative;
        pos = Math.max(obs.negative, Math.min(obs.positive - size, obs.negative + (gap - size) * ratio));
      }

      const atNeg = obs.negative === this.container[axis];
      const atPos = obs.positive === this.container[maxA];

      if (preferWallNeg && preferWallPos && atNeg && atPos) {
        pos = this.container[axis] + (this.container[maxA] - size) / 2;
      } else {
        if (preferWallNeg && needN && atNeg &&
            (!atPos || rect[axis] - this.container[axis] < this.container[maxA] - rect[maxA])) {
          pos = this.container[axis];
        }
        if (preferWallPos && needP && atPos && this.container[axis] !== rect[axis]) {
          pos = this.container[maxA] - size;
        }
      }

      pos = Math.max(
        this.container[axis],
        Math.min(this.container[maxA] - size, Math.round(pos)),
      );

      if (pos === rect[axis]) return false;
      this.translateRectangle(rect, axis, pos);
      return true;
    }

    /**
     * Unconditionally move `rect` to `newPosition` along `axis`.
     * Does not check for obstructions — caller is responsible.
     */
    translateRectangle(rect: Rect, axis: Axis, newPosition: number): void {
      this._translateParallel(rect, axis, newPosition);
      this._translatePerpendicular(rect, axis, newPosition);

      const size   = rect[sizeOf(axis)];
      const freq   = this[axis].frequencies as Record<number, number>;
      const oldPos = rect[axis];
      const oldMax = oldPos + size;
      const newMax = newPosition + size;

      freq[newPosition] = (freq[newPosition] ?? 0) + 1;
      freq[newMax]      = (freq[newMax]      ?? 0) + 1;

      this._decrementFreq(axis, oldPos, freq);
      this._decrementFreq(axis, oldMax, freq);

      rect[axis] = newPosition;

      if (freq[newPosition] === 1) this.populateSubTree(axis, newPosition);
      if (freq[newMax]      === 1) this.populateSubTree(axis, newMax);

      // Guard: max-edge slab must not retain rect (off-by-one edge case)
      const oppAxis = opp(axis);
      const maxSlab = this[axis].bst.get(newMax);
      if (maxSlab?.get(rect[oppAxis]) === rect) {
        this[axis].bst = this[axis].bst.remove(newMax).insert(newMax, maxSlab.remove(rect[oppAxis]));
      }
    }

    // ── Private index-mutation helpers ────────────────────────────────────────

    private _translateParallel(rect: Rect, axis: Axis, newPos: number): void {
      const oppAxis = opp(axis);
      const maxOpp  = maxOf(oppAxis);
      let iter      = this[oppAxis].bst.find(rect[oppAxis]);

      while (iter.valid) {
        const { key, value } = iter;
        if (key >= rect[maxOpp]) break;
        const without = value.remove(rect[axis]);
        if (without.get(newPos)) { iter.next(); continue; }
        const updated = without.insert(newPos, rect);
        this[oppAxis].bst = iter.remove(key).insert(key, updated);
        iter = this[oppAxis].bst.gt(key);
      }
    }

    private _translatePerpendicular(rect: Rect, axis: Axis, newPos: number): void {
      const oppAxis = opp(axis);
      const size    = rect[sizeOf(axis)];
      const newMax  = newPos + size;
      const maxA    = maxOf(axis);

      this.getOrCreateSubTree(axis, newPos);
      this.getOrCreateSubTree(axis, newMax);

      // Remove from old range
      let iter = this[axis].bst.find(rect[axis]);
      while (iter.valid) {
        const { key, value } = iter;
        if (key >= rect[maxA]) break;
        this[axis].bst = iter.update(value.remove(rect[oppAxis]));
        iter = this[axis].bst.gt(key);
      }

      // Insert into new range
      iter = this[axis].bst.find(newPos);
      while (iter.valid) {
        const { key, value } = iter;
        if (key >= newMax) break;
        this[axis].bst = iter.update(value.insert(rect[oppAxis], rect));
        iter = this[axis].bst.gt(key);
      }
    }

    private _decrementFreq(axis: Axis, pos: number, freq: Record<number, number>): void {
      freq[pos]--;
      if (freq[pos] === 0) {
        delete freq[pos];
        if (pos !== 0) this[axis].bst = this[axis].bst.remove(pos);
      }
    }
  };
}

// ─── Concrete class ───────────────────────────────────────────────────────────

export class MasonTreeWithLayout extends LayoutMixin(MasonTree) {}
