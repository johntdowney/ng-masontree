import {
  AfterContentInit,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Input,
  NgZone,
  OnChanges,
  OnDestroy,
  SimpleChanges,
  inject,
} from '@angular/core';
import { MasonTreeWithLayout } from './mason-tree-layout';
import { PullOptions, PullOptionsResolver } from './mason-tree-layout';

// ─── Public options type ──────────────────────────────────────────────────────

export interface MasonTreeOptions {
  /**
   * Number of iterative repositioning passes to run after packing.
   * @default 8
   */
  iterations?: number;

  /**
   * Pull options applied to every rectangle, or a function that receives a
   * rect's DOM element and returns per-rect options.
   *
   * Defaults produce centred, wall-free spacing.
   */
  pull?: PullOptions | ((el: HTMLElement) => PullOptions);

  /**
   * How positions are written back to each child element.
   *
   * - `'transform'`  — single `translate` on the `transform` property (GPU-composited, best perf)
   * - `'top-left'`   — `top` + `left` + `translateX(-50%)`
   * - `'top-transform'` — `top` + `translateX(-50%) translateX(${x}px)` (default / preferred)
   */
  positionMode?: 'transform' | 'top-left' | 'top-transform';

  /**
   * Gap (in px) added around each rectangle before packing.
   * Creates visual spacing between items without you needing to add margins.
   * @default 8
   */
  gap?: number;
}

// ─── Default options ──────────────────────────────────────────────────────────

const DEFAULTS: Required<MasonTreeOptions> = {
  iterations:   8,
  pull:         {
    pullX:            true,
    pullY:            true,
    pullXValue:       0,
    pullYValue:       0,
    stickyLeftWall:   false,
    stickyTopWall:    false,
    stickyRightWall:  false,
    stickyBottomWall: false,
  },
  positionMode: 'top-transform',
  gap:          8,
};

// ─── Component ────────────────────────────────────────────────────────────────

/**
 * `<masontree>` — a layout container that packs its direct children using the
 * MasonTree bin-packing algorithm and then iteratively repositions them for
 * even spacing.
 *
 * Children must be **positioned elements** (`position: absolute` is set
 * automatically).  The host element's width drives the layout; its height is
 * set automatically by the algorithm output.
 *
 * ```html
 * <masontree [opts]="{ gap: 12, iterations: 6 }">
 *   <div style="width: 200px; height: 302px">Item A</div>
 *   <div style="width: 102px; height: 120px">Item B</div>
 * </masontree>
 * ```
 */
@Component({
  selector:        'masontree',
  standalone:      true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template:        '<ng-content/>',
  styles: [`
    :host {
      display:  block;
      position: relative;
      /* Height is driven by the algorithm — never set it in CSS */
    }
  `],
})
export class MasonTreeComponent implements AfterContentInit, OnChanges, OnDestroy {

  @Input() opts?: MasonTreeOptions;

  // ── DI ─────────────────────────────────────────────────────────────────────
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly zone = inject(NgZone);

  // ── State ───────────────────────────────────────────────────────────────────
  private containerObserver!: ResizeObserver;
  private childObserver!:     ResizeObserver;
  private childMutations!:    MutationObserver;
  private scheduled           = false;

  // ── Lifecycle ────────────────────────────────────────────────────────────────

  ngAfterContentInit(): void {
    // All observation is set up outside Angular's zone so ResizeObserver
    // callbacks don't trigger unnecessary change-detection cycles.
    this.zone.runOutsideAngular(() => {
      // Watch container width changes
      this.containerObserver = new ResizeObserver(() => this._schedule());
      this.containerObserver.observe(this.host.nativeElement);

      // Watch child size changes
      this.childObserver = new ResizeObserver(() => this._schedule());
      this._observeChildren();

      // Watch DOM children being added / removed
      this.childMutations = new MutationObserver(() => {
        this._observeChildren();
        this._schedule();
      });
      this.childMutations.observe(this.host.nativeElement, { childList: true });
    });

    // Run once immediately for the initial layout
    this._runLayout();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['opts'] && !changes['opts'].firstChange) {
      this._schedule();
    }
  }

  ngOnDestroy(): void {
    this.containerObserver?.disconnect();
    this.childObserver?.disconnect();
    this.childMutations?.disconnect();
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  /** Register every direct child with the child ResizeObserver. */
  private _observeChildren(): void {
    this.childObserver.disconnect();
    for (const child of this._children()) {
      this.childObserver.observe(child);
    }
  }

  /** Debounce multiple synchronous resize events into one layout pass. */
  private _schedule(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    requestAnimationFrame(() => {
      this.scheduled = false;
      this._runLayout();
    });
  }

  private _children(): HTMLElement[] {
    return Array.from(this.host.nativeElement.children) as HTMLElement[];
  }

  private _runLayout(): void {
    const options      = { ...DEFAULTS, ...this.opts };
    const gap          = options.gap;
    const hostEl       = this.host.nativeElement;
    const containerW   = hostEl.getBoundingClientRect().width;
    const children     = this._children();

    if (children.length === 0 || containerW === 0) return;

    // ── Build a fresh tree each layout pass ───────────────────────────────────
    // MasonTree is an immutable-ish functional structure; re-building is cheap
    // compared to mutating across layout passes with changing children.
    const tree = new MasonTreeWithLayout(Math.floor(containerW));

    // We pack inflated rects (rect + gap on each side) and then remove the
    // gap offset when writing positions back, giving us inter-item spacing.
    const rectInits = children.map((el, i) => {
      const { width, height } = el.getBoundingClientRect();
      return {
        id: i,
        x:  0,
        y:  0,
        w:  Math.max(1, Math.round(width  + gap * 2)),
        h:  Math.max(1, Math.round(height + gap * 2)),
      };
    });

    tree.addRect(...rectInits);

    // ── Iterative repositioning ───────────────────────────────────────────────
    const pullOpts = options.pull;
    tree.iterativelyAdjustRectangles(
      options.iterations,
      typeof pullOpts === 'function'
        ? (id: unknown) => (pullOpts as (el: HTMLElement) => PullOptions)(children[id as number])
        : pullOpts,
    );

    // ── Write positions back to the DOM ───────────────────────────────────────
    const mode = options.positionMode;

    for (const [id, rect] of tree.rects) {
      const el = children[id as number];
      if (!el) continue;

      // Subtract the gap padding so the visual rect aligns to the packed position
      const x = rect.x + gap;
      const y = rect.y + gap;

      el.style.position = 'absolute';

      switch (mode) {
        case 'transform':
          el.style.left      = '';
          el.style.top       = '';
          el.style.transform = `translate(${x}px, ${y}px)`;
          break;

        case 'top-left':
          el.style.left      = `${x}px`;
          el.style.top       = `${y}px`;
          el.style.transform = '';
          break;

        case 'top-transform':
        default:
          el.style.left      = '';
          el.style.top       = `${y}px`;
          el.style.transform = `translateX(${x}px)`;
          break;
      }
    }

    // ── Set host height to match packed content ───────────────────────────────
    hostEl.style.height = `${tree.height}px`;
  }
}
