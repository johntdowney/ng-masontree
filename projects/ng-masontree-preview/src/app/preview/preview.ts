import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  NgZone,
  OnDestroy,
  signal,
  ViewChild,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NgClass, NgStyle } from '@angular/common';
import { MasonItemDirective, MasontreeComponent, MasontreeOptions } from 'ng-masontree';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ItemDef {
  id: number;
  w: number;
  h: number;
  label: string;
  color: string;
  locked: boolean;
  lockX: number;
  lockY: number;
  margin?: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const COLORS = [
  '#e05c5c',
  '#5c8fe0',
  '#5cc47a',
  '#c45ce0',
  '#e0a25c',
  '#5ccee0',
  '#e0d45c',
  '#a05ce0',
];

let _nextId = 1;

function makeItem(overrides: Partial<ItemDef> = {}): ItemDef {
  const id = _nextId++;
  return {
    id,
    w: 100 + Math.round(Math.random() * 120),
    h: 80 + Math.round(Math.random() * 100),
    label: `Item ${id}`,
    color: COLORS[id % COLORS.length],
    locked: false,
    lockX: 0,
    lockY: 0,
    ...overrides,
  };
}

// ─── Component ────────────────────────────────────────────────────────────────

@Component({
  selector: 'masontree-preview',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MasontreeComponent, MasonItemDirective, FormsModule, NgStyle, NgClass],

  templateUrl: './preview.html',
  styleUrl: './preview.scss',
})
export class MasontreePreviewComponent implements AfterViewInit, OnDestroy {
  @ViewChild('masontreeEl', { read: ElementRef }) masontreeElRef!: ElementRef<HTMLElement>;

  containerWidth = signal(600);
  gap = signal(8);
  iterations = signal(8);
  pullX = signal(0);
  pullY = signal(0);
  draggingId = signal<number | null>(null);

  // Extra min-height added to the masontree container during drag so the user
  // can drag a tile below the natural content bottom without the container
  // shrinking underneath them. Resets to 0 on drop.
  dragMinHeight = signal(0);

  items = signal<ItemDef[]>([
    makeItem({ w: 180, h: 120, label: 'Item 1' }),
    makeItem({ w: 120, h: 160, label: 'Item 2' }),
    makeItem({ w: 200, h: 80, label: 'Item 3' }),
    makeItem({ w: 100, h: 100, label: 'Item 4', locked: true, lockX: 240, lockY: 20 }),
    makeItem({ w: 140, h: 100, label: 'Item 5' }),
  ]);

  opts = computed<MasontreeOptions>(() => ({
    gap: this.gap(),
    iterations: this.iterations(),
    transition: (id: unknown) => 'top 500ms ease, transform 500ms ease',
    pull: { pullXValue: this.pullX(), pullYValue: this.pullY() },
  }));

  onLockClick(e: MouseEvent, id: number): void {
    e.stopPropagation();
    if (this.draggingId() !== id) this.toggleLock(id);
  }

  onDeleteClick(e: MouseEvent, id: number): void {
    e.stopPropagation();
    this.remove(id);
  }

  // ── Drag state ─────────────────────────────────────────────────────────────

  dragState: {
    id: number;
    // Offset from mouse to tile top-left at drag start
    offsetX: number;
    offsetY: number;
    // masontree container rect at drag start (stable during drag)
    containerRect: DOMRect;
    // natural height of container at drag start — used to compute dragMinHeight
    containerH: number;
    containerW: number;
  } | null = null;

  private onMouseMove = (e: MouseEvent) => this.handleMouseMove(e);
  private onMouseUp = (e: MouseEvent) => this.handleMouseUp(e);

  constructor(private readonly zone: NgZone) {}

  ngAfterViewInit(): void {}

  ngOnDestroy(): void {
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('mouseup', this.onMouseUp);
  }

  // ── Tile interaction ───────────────────────────────────────────────────────

  toggleLock(id: number): void {
    const item = this.items().find((i) => i.id === id);
    if (!item) return;

    if (item.locked) {
      // Unlock — forget the fixed position
      this.update(id, 'locked', false);
    } else {
      // Lock — capture the tile's current rendered position
      const pos = this.getTileRenderedPosition(id);
      this.items.update((list) =>
        list.map((i) => (i.id === id ? { ...i, locked: true, lockX: pos.x, lockY: pos.y } : i)),
      );
    }
  }

  onTileMouseDown(e: MouseEvent, id: number): void {
    // Only respond to left button; ignore clicks on the lock button (stopPropagation handles that)
    if (e.button !== 0) return;
    if (e.target instanceof HTMLElement && e.target.closest('.tile-lock-btn')) return;
    e.preventDefault();

    const containerEl = this.masontreeElRef.nativeElement;
    const containerRect = containerEl.getBoundingClientRect();
    const containerH = parseFloat(containerEl.style.height) || containerRect.height;
    const containerW = parseFloat(containerEl.style.width) || containerRect.width;

    // Find the tile element — it's the target or an ancestor inside masontree
    const tileEl = e.currentTarget as HTMLElement;
    const tileRect = tileEl.getBoundingClientRect();

    const offsetX = e.clientX - tileRect.left;
    const offsetY = e.clientY - tileRect.top;

    // Lock the item at its current position if not already locked
    const item = this.items().find((i) => i.id === id)!;
    const pos = this.getTileRenderedPosition(id);

    this.zone.run(() => {
      this.draggingId.set(id);
      // Add generous drag padding so container doesn't shrink during drag
      this.dragMinHeight.set(containerH + 200);

      if (!item.locked) {
        this.items.update((list) =>
          list.map((i) =>
            i.id === id
              ? { ...i, locked: true, lockX: Math.max(0, pos.x), lockY: Math.max(0, pos.y) }
              : i,
          ),
        );
      }
    });

    this.dragState = { id, offsetX, offsetY, containerRect, containerH, containerW };

    // Attach document-level listeners outside Angular zone for performance
    this.zone.runOutsideAngular(() => {
      document.addEventListener('mousemove', this.onMouseMove);
      document.addEventListener('mouseup', this.onMouseUp);
    });
  }

  private handleMouseMove(e: MouseEvent): void {
    if (!this.dragState) return;
    const { id, offsetX, offsetY, containerRect } = this.dragState;

    // Position relative to container top-left
    const item = this.items().find((i) => i.id === id);
    const newX = Math.min(
      containerRect.right - containerRect.left - (item?.w ?? 0),
      Math.max(0, Math.round(e.clientX - containerRect.left - offsetX)),
    );
    const newY = Math.max(0, Math.round(e.clientY - containerRect.top - offsetY));

    // Expand drag padding if the tile is being dragged below the container's
    // natural height — keep 200px of breathing room below the tile bottom
    if (item) {
      const tileBottom = newY + item.h;
      const needed = tileBottom + 200;
      if (needed > this.dragMinHeight()) {
        this.zone.run(() => this.dragMinHeight.set(needed));
      }
    }

    this.zone.run(() => {
      this.items.update((list) =>
        list.map((i) => (i.id === id ? { ...i, lockX: newX, lockY: newY } : i)),
      );
    });
  }

  private handleMouseUp(_e: MouseEvent): void {
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('mouseup', this.onMouseUp);

    this.zone.run(() => {
      this.draggingId.set(null);
      // Reset drag padding — the masontree height will settle to its natural value
      this.dragMinHeight.set(0);
    });

    this.dragState = null;
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  /**
   * Read a tile's current rendered position from its DOM styles.
   * The masontree component writes: top = y, transform = translateX(xpx).
   */
  private getTileRenderedPosition(id: number): { x: number; y: number } {
    const containerEl = this.masontreeElRef?.nativeElement;
    if (!containerEl) return { x: 0, y: 0 };

    // Items are in the same order as items() array
    const idx = this.items().findIndex((i) => i.id === id);
    const tileEl = containerEl.children[idx] as HTMLElement | undefined;
    if (!tileEl) return { x: 0, y: 0 };

    const x = Math.floor(
      Math.max(
        0,
        parseFloat(tileEl.style.transform.replace(/translateX\((-?[\d.]+)px\)/, '$1')) || 0,
      ),
    );
    const y = Math.floor(Math.max(0, parseFloat(tileEl.style.top) || 0));
    return { x, y };
  }

  // ── Signal mutations ───────────────────────────────────────────────────────

  addFree(): void {
    this.items.update((l) => [...l, makeItem()]);
  }
  addLocked(): void {
    this.items.update((l) => [...l, makeItem({ locked: true, lockX: 50, lockY: 50 })]);
  }
  remove(id: number): void {
    this.items.update((l) => l.filter((i) => i.id !== id));
  }

  update(id: number, field: keyof ItemDef, value: unknown): void {
    this.items.update((l) => l.map((i) => (i.id === id ? { ...i, [field]: value } : i)));
  }

  trackById(_: number, item: ItemDef): number {
    return item.id;
  }
}
