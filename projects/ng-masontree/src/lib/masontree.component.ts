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

const MASON_DATA_KEY = '__masonData';

export interface MasonItemData {
  margin?: number;
  locked: boolean;
  x: number;
  y: number;
}

/**
 * Optional directive for direct children of `<masontree>`.
 *
 * Without inputs it is a no-op marker; its value is in the optional inputs:
 *
 * `[masonMargin]`  — overrides the container's global gap for this item.
 *
 * `[masonLocked]`  — when true, the item is placed at exactly the position
 *                    given by `[masonX]` / `[masonY]` and never moved.
 *                    Locked items obstruct unlocked items but may overlap
 *                    each other.
 *
 * `[masonX]` / `[masonY]`  — the fixed position for a locked item.
 *                             Ignored when `[masonLocked]` is false.
 */
@Directive({
  selector: '[masonItem]',
  standalone: true,
})
export class MasonItemDirective implements OnChanges {
  @Input() masonMargin?: number;
  @Input() masonLocked = false;
  @Input() masonX = 0;
  @Input() masonY = 0;

  constructor(private readonly elRef: ElementRef<HTMLElement>) {
    this.write();
  }

  ngOnChanges(): void {
    this.write();
  }

  private write(): void {
    const data: MasonItemData = {
      margin: this.masonMargin != null ? Math.max(0, this.masonMargin) : undefined,
      locked: this.masonLocked,
      x: this.masonX,
      y: this.masonY,
    };
    (this.elRef.nativeElement as any)[MASON_DATA_KEY] = data;
    this.elRef.nativeElement.dispatchEvent(new CustomEvent('masonItemChange', { bubbles: true }));
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

export interface MasontreeOptions {
  /** Global gap in px between rects. Does not apply at container edges. @default 0 */
  gap?: number;
  /** Repositioning passes. @default 8 */
  iterations?: number;
  /** Pull bias for all rects, or a function from child HTMLElement to options. */
  pull?: PullOptions | ((el: HTMLElement) => PullOptions);
  /**
   * CSS transition for position changes. Set to '' to disable.
   * @default 'top 200ms ease, transform 200ms ease'
   */
  transition?: (id: unknown) => string;
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
  private masonItemListener = () => this.schedule();

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
      this.hostEl.addEventListener('masonItemChange', this.masonItemListener);
    });

    this.runLayout({ animate: false });
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (!changes['opts']?.firstChange) this.schedule();
  }

  ngOnDestroy(): void {
    this.containerObs?.disconnect();
    this.childObs?.disconnect();
    this.mutationObs?.disconnect();
    this.hostEl?.removeEventListener('masonItemChange', this.masonItemListener);
  }

  private observeChildren(): void {
    this.childObs.disconnect();
    for (const child of this.children()) this.childObs.observe(child);
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
    const transition = (id: unknown) =>
      animate ? ((this.opts?.transition && this.opts?.transition(id)) ?? DEFAULT_TRANSITION) : '';

    const children = this.children();
    const containerW = this.hostEl.getBoundingClientRect().width;
    if (children.length === 0 || containerW === 0) return;

    const tree = new Masontree(containerW, gap);

    tree.addRect(
      ...children.map((el, i) => {
        const { width, height } = el.getBoundingClientRect();
        const data = (el as any)[MASON_DATA_KEY] as MasonItemData | undefined;
        return {
          id: i,
          w: Math.max(1, Math.round(width)),
          h: Math.max(1, Math.round(height)),
          margin: data?.margin,
          locked: data?.locked ?? false,
          x: data?.x ?? 0,
          y: data?.y ?? 0,
        };
      }),
    );

    tree.iterativelyAdjust(
      iterations,
      typeof pull === 'function'
        ? (id: unknown) => (pull as (el: HTMLElement) => PullOptions)(children[id as number])
        : pull,
    );

    for (const [id, rect] of tree.rects) {
      const el = children[id as number];
      if (!el) continue;
      const { x, y } = rect;
      const prev = this.positions.get(el);
      const moved = !prev || prev.x !== x || prev.y !== y;
      el.style.transition = transition(id);
      if (moved) {
        el.style.position = 'absolute';
        el.style.top = `${y}px`;
        el.style.transform = `translateX(${x}px)`;
        this.positions.set(el, { x, y });
      }
    }

    for (const el of this.positions.keys()) {
      if (!children.includes(el)) this.positions.delete(el);
    }

    this.hostEl.style.height = `${tree.height}px`;
  }
}
