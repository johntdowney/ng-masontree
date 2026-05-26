import {
  AfterContentInit,
  ChangeDetectionStrategy,
  Component,
  Directive,
  ElementRef,
  Input,
  NgZone,
  OnChanges,
  OnDestroy,
  SimpleChanges,
} from '@angular/core';
import { Masontree, PullOptions } from '@johntdowney/masontree/dist';

// ─── MasonItem directive ──────────────────────────────────────────────────────
//
// Optional directive on any direct child of <masontree>.
// Allows per-rect margin override of the container's global gap.
//
// Usage:
//   <div masonItem [masonMargin]="24">big gap around this one</div>
//   <div masonItem>uses container gap</div>
//
// The margin collapses with its neighbours: the space between two rects is
// Math.max(rectA.margin, rectB.margin). Rects flush with a container wall
// always have zero margin on that edge regardless of masonMargin.

const MASON_MARGIN_KEY = '__masonMargin';

@Directive({
  selector: '[masonItem]',
  standalone: true,
})
export class MasonItemDirective implements OnChanges {
  @Input() masonMargin?: number;

  constructor(private readonly elRef: ElementRef<HTMLElement>) {
    this.write();
  }

  ngOnChanges(): void {
    this.write();
  }

  private write(): void {
    (this.elRef.nativeElement as any)[MASON_MARGIN_KEY] =
      this.masonMargin != null ? Math.max(0, this.masonMargin) : undefined;
  }
}

// ─── Masontree component ──────────────────────────────────────────────────────

export interface MasontreeOptions {
  /**
   * Global gap in px between packed rectangles.
   * Collapses with per-rect [masonMargin] — the larger value wins.
   * Does NOT add margin at the container edges.
   * @default 0
   */
  gap?: number;

  /** Repositioning passes after initial packing. @default 8 */
  iterations?: number;

  /** Pull bias for all rects, or a function from child HTMLElement to options. */
  pull?: PullOptions | ((el: HTMLElement) => PullOptions);

  /**
   * CSS transition for position changes.
   * Set to '' to disable animation.
   * @default 'top 200ms ease, transform 200ms ease'
   */
  transition?: string;
}

const DEFAULT_TRANSITION = 'top 200ms ease, transform 200ms ease';

@Component({
  selector: 'masontree',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<ng-content />`,
  styles: [
    `
      :host {
        display: block;
        position: relative;
      }
    `,
  ],
})
export class MasontreeComponent implements AfterContentInit, OnChanges, OnDestroy {
  @Input() opts?: MasontreeOptions;

  private hostEl!: HTMLElement;
  private containerObs!: ResizeObserver;
  private childObs!: ResizeObserver;
  private mutationObs!: MutationObserver;
  private pending = false;
  private positions = new Map<HTMLElement, { x: number; y: number }>();

  constructor(
    private readonly elRef: ElementRef<HTMLElement>,
    private readonly zone: NgZone,
  ) {}

  ngAfterContentInit(): void {
    this.hostEl = this.elRef.nativeElement;

    this.zone.runOutsideAngular(() => {
      this.containerObs = new ResizeObserver(() => this.schedule());
      this.containerObs.observe(this.hostEl);

      this.childObs = new ResizeObserver(() => this.schedule());
      this.observeChildren();

      this.mutationObs = new MutationObserver(() => {
        this.observeChildren();
        this.schedule();
      });
      this.mutationObs.observe(this.hostEl, { childList: true });
    });

    // First render — no transition so items snap into place immediately.
    this.runLayout({ animate: false });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['opts']?.firstChange) this.schedule();
  }

  ngOnDestroy(): void {
    this.containerObs?.disconnect();
    this.childObs?.disconnect();
    this.mutationObs?.disconnect();
  }

  private observeChildren(): void {
    this.childObs.disconnect();
    for (const child of this.children()) {
      this.childObs.observe(child);
    }
  }

  private schedule(): void {
    if (this.pending) return;
    this.pending = true;
    requestAnimationFrame(() => {
      this.pending = false;
      this.runLayout({ animate: true });
    });
  }

  private children(): HTMLElement[] {
    return Array.from(this.hostEl.children) as HTMLElement[];
  }

  private runLayout({ animate }: { animate: boolean }): void {
    const gap = this.opts?.gap ?? 0;
    const iterations = this.opts?.iterations ?? 8;
    const pull = this.opts?.pull;
    const transition = animate ? (this.opts?.transition ?? DEFAULT_TRANSITION) : '';

    const children = this.children();
    const containerW = this.hostEl.getBoundingClientRect().width;

    if (children.length === 0 || containerW === 0) return;

    // Build tree with the true container width and global gap.
    const tree = new Masontree(containerW, gap);

    // Pack with true sizes — no inflation.
    // Per-rect margin is read from the [masonItem] directive's property if set,
    // otherwise the tree's defaultGap applies.
    tree.addRect(
      ...children.map((el, i) => {
        const { width, height } = el.getBoundingClientRect();
        const perRectMargin = (el as any)[MASON_MARGIN_KEY] as number | undefined;
        return {
          id: i,
          w: Math.max(1, Math.round(width)),
          h: Math.max(1, Math.round(height)),
          margin: perRectMargin, // undefined → tree uses defaultGap
        };
      }),
    );

    tree.iterativelyAdjust(
      iterations,
      typeof pull === 'function'
        ? (id: unknown) => (pull as (el: HTMLElement) => PullOptions)(children[id as number])
        : pull,
    );

    // Write positions. rect.x / rect.y are the true visual origins.
    for (const [id, rect] of tree.rects) {
      const el = children[id as number];
      if (!el) continue;

      const { x, y } = rect;
      const prev = this.positions.get(el);
      const moved = !prev || prev.x !== x || prev.y !== y;

      if (moved) {
        el.style.transition = transition;
        el.style.position = 'absolute';
        el.style.top = `${y}px`;
        el.style.transform = `translateX(${x}px)`;
        this.positions.set(el, { x, y });
      }
    }

    // Evict removed elements from the cache.
    for (const el of this.positions.keys()) {
      if (!children.includes(el)) this.positions.delete(el);
    }

    this.hostEl.style.height = `${tree.height}px`;
  }
}
