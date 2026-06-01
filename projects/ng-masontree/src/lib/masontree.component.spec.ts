import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component } from '@angular/core';
import { By } from '@angular/platform-browser';
import { MasonItemDirective, MasontreeOptions, MasontreeComponent } from './masontree.component';

// Mock the ResizeObserver
import ResizeObserver from 'resize-observer-polyfill';

vi.stubGlobal('ResizeObserver', ResizeObserver);

// Layout mocking
// ————————————————————————————————————————————————————————————————————————————
// jsdom never does layout so getBoundingClientRect() always returns all zeros.
// The component calls it synchronously inside ngAfterContentInit, so we cannot
// spy on individual elements after createComponent() — the first layout pass
// has already run by then.
//
// The solution: mock HTMLElement.prototype.getBoundingClientRect BEFORE
// createComponent, using a callback that inspects the element to decide what
// to return. Restore it in afterEach.

type RectMap = Map<HTMLElement, Partial<DOMRect>>;

let activeRectMap: RectMap | null = null;
let containerSelector = 'masontree';
let defaultChildRect: Partial<DOMRect> = { width: 100, height: 80 };
let defaultContainerRect: Partial<DOMRect> = { width: 400, height: 0 };

const originalGetBCR = HTMLElement.prototype.getBoundingClientRect;

function installMock(
  containerRect: Partial<DOMRect> = defaultContainerRect,
  childRect: Partial<DOMRect> = defaultChildRect,
): void {
  activeRectMap = new Map();
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement): DOMRect {
    // Use per-element override if registered
    if (activeRectMap?.has(this)) {
      return toRect(activeRectMap.get(this)!);
    }
    // masontree host element
    if (this.tagName.toLowerCase() === containerSelector) {
      return toRect(containerRect);
    }
    // direct children of masontree
    if (this.parentElement?.tagName.toLowerCase() === containerSelector) {
      return toRect(childRect);
    }
    return toRect({});
  };
}

function uninstallMock(): void {
  HTMLElement.prototype.getBoundingClientRect = originalGetBCR;
  activeRectMap = null;
}

function toRect(r: Partial<DOMRect>): DOMRect {
  return {
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    width: 0,
    height: 0,
    toJSON: () => ({}),
    ...r,
  };
}

/** Flush one rAF tick + microtask so schedule() → runLayout() completes. */
async function flushLayout(): Promise<void> {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await Promise.resolve();
}

function getX(el: HTMLElement): number {
  const m = el.style.transform.match(/translateX\((-?[\d.]+)px\)/);
  const result = m ? parseFloat(m[1]) : 0;
  return result;
}

function getY(el: HTMLElement): number {
  return parseFloat(el.style.top) || 0;
}

// Host components
// ————————————————————————————————————————————————————————————————————————————

@Component({
  standalone: true,
  imports: [MasontreeComponent],
  template: `
    <masontree [opts]="opts">
      <div id="r1"></div>
      <div id="r2"></div>
    </masontree>
  `,
})
class TwoRectsHost {
  opts?: MasontreeOptions;
}

@Component({
  standalone: true,
  imports: [MasontreeComponent, MasonItemDirective],
  template: `
    <masontree [opts]="opts">
      <div masonItem [masonMargin]="margin" id="r1"></div>
      <div masonItem [masonMargin]="margin" id="r2"></div>
    </masontree>
  `,
})
class MasonItemHost {
  opts?: MasontreeOptions;
  margin = 0;
}

// MasonTreeComponent
// ————————————————————————————————————————————————————————————————————————————

describe('MasonTreeComponent', () => {
  describe('basic rendering — 400px container, 100×80 children', () => {
    let fixture: ComponentFixture<TwoRectsHost>;

    beforeEach(async () => {
      // Mock BEFORE createComponent so the synchronous first layout sees real dimensions
      installMock({ width: 400 }, { width: 100, height: 80 });

      await TestBed.configureTestingModule({ imports: [TwoRectsHost] }).compileComponents();
      fixture = TestBed.createComponent(TwoRectsHost);
      fixture.componentInstance.opts = { iterations: 0, gap: 10 };

      // fixture = TestBed.createComponent(TwoRectsHost, {
      //   bindings: [inputBinding('opts', () => ({}))],
      // });
      fixture.detectChanges();
      // The first layout runs synchronously in ngAfterContentInit.
      // schedule() queues a second pass via rAF — flush it too.
      await flushLayout();
    });

    afterEach(() => {
      uninstallMock();
      TestBed.resetTestingModule();
    });

    it('creates the masontree component', () => {
      expect(fixture.debugElement.query(By.directive(MasontreeComponent))).toBeTruthy();
    });

    it('sets position: absolute on each child', () => {
      const children = Array.from(
        fixture.nativeElement.querySelectorAll('masontree > div'),
      ) as HTMLElement[];
      expect(children.length).toBe(2);
      for (const child of children) {
        expect(child.style.position).toBe('absolute');
      }
    });

    it('sets a top style on each child', () => {
      const children = Array.from(
        fixture.nativeElement.querySelectorAll('masontree > div'),
      ) as HTMLElement[];
      for (const child of children) {
        expect(child.style.top).toMatch(/\d+px/);
      }
    });

    it('sets transform: translateX on each child', () => {
      const children = Array.from(
        fixture.nativeElement.querySelectorAll('masontree > div'),
      ) as HTMLElement[];
      for (const child of children) {
        expect(child.style.transform).toMatch(/translateX/);
      }
    });

    it('first child is at origin (0, 0)', () => {
      const r1 = fixture.nativeElement.querySelector('#r1') as HTMLElement;
      expect(getX(r1)).toBe(0);
      expect(getY(r1)).toBe(0);
    });

    it('second child sits to the right of the first (fits in one row)', () => {
      const r1 = fixture.nativeElement.querySelector('#r1') as HTMLElement;
      const r2 = fixture.nativeElement.querySelector('#r2') as HTMLElement;
      // Same row
      expect(getY(r2)).toBe(0);
      // To the right
      expect(getX(r2)).toBe(110); // r1.x(0) + r1.w(100)
    });

    it('host height equals the height of one row (80px)', () => {
      const masontree = fixture.nativeElement.querySelector('masontree') as HTMLElement;
      expect(parseFloat(masontree.style.height)).toBe(80);
    });

    it('children do not overlap', () => {
      const children = Array.from(
        fixture.nativeElement.querySelectorAll('masontree > div'),
      ) as HTMLElement[];
      const rects = children.map((el) => ({ x: getX(el), y: getY(el), w: 100, h: 80 }));
      for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          const a = rects[i],
            b = rects[j];
          const overlapping =
            a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
          expect(overlapping).toBe(false);
        }
      }
    });
  });

  describe('wrapping — 150px container, 100px-wide children', () => {
    afterEach(() => {
      uninstallMock();
      TestBed.resetTestingModule();
    });

    it('wraps second rect to next row when too wide to fit', async () => {
      installMock({ width: 150 }, { width: 100, height: 80 });
      await TestBed.configureTestingModule({ imports: [TwoRectsHost] }).compileComponents();
      const fixture = TestBed.createComponent(TwoRectsHost);
      fixture.componentInstance.opts = { iterations: 0 };
      fixture.detectChanges();
      await flushLayout();

      const r2 = fixture.nativeElement.querySelector('#r2') as HTMLElement;
      expect(getX(r2)).toBe(0);
      expect(getY(r2)).toBe(80);
    });

    it('host height spans both rows (160px)', async () => {
      installMock({ width: 150 }, { width: 100, height: 80 });
      await TestBed.configureTestingModule({ imports: [TwoRectsHost] }).compileComponents();
      const fixture = TestBed.createComponent(TwoRectsHost);
      fixture.detectChanges();
      await flushLayout();

      const masontree = fixture.nativeElement.querySelector('masontree') as HTMLElement;
      expect(parseFloat(masontree.style.height)).toBe(160);
    });
  });

  describe('gap — 400px container, 100×80 children, gap 20, iterations 0', () => {
    afterEach(() => {
      uninstallMock();
      TestBed.resetTestingModule();
    });

    it('r2 starts at r1.maxX + gap', async () => {
      installMock({ width: 400 }, { width: 100, height: 80 });
      await TestBed.configureTestingModule({ imports: [TwoRectsHost] }).compileComponents();
      const fixture = TestBed.createComponent(TwoRectsHost);
      fixture.componentInstance.opts = { gap: 20, iterations: 0 };
      fixture.detectChanges();
      await flushLayout();

      const r1 = fixture.nativeElement.querySelector('#r1') as HTMLElement;
      const r2 = fixture.nativeElement.querySelector('#r2') as HTMLElement;
      expect(getX(r1)).toBe(0);
      expect(getX(r2)).toBe(120); // 0 + 100 + 20
    });

    it('first rect is flush with left wall despite gap', async () => {
      installMock({ width: 400 }, { width: 100, height: 80 });
      await TestBed.configureTestingModule({ imports: [TwoRectsHost] }).compileComponents();
      const fixture = TestBed.createComponent(TwoRectsHost);
      fixture.componentInstance.opts = { gap: 20, iterations: 0 };
      fixture.detectChanges();
      await flushLayout();

      const r1 = fixture.nativeElement.querySelector('#r1') as HTMLElement;
      expect(getX(r1)).toBe(0);
      expect(getY(r1)).toBe(0);
    });
  });

  describe('no layout when container width is 0', () => {
    afterEach(() => {
      uninstallMock();
      TestBed.resetTestingModule();
    });

    it('does not position children when containerW is 0', async () => {
      // No installMock — jsdom returns 0 naturally
      await TestBed.configureTestingModule({ imports: [TwoRectsHost] }).compileComponents();
      const fixture = TestBed.createComponent(TwoRectsHost);
      fixture.detectChanges();
      await flushLayout();

      const r1 = fixture.nativeElement.querySelector('#r1') as HTMLElement;
      expect(r1.style.position).not.toBe('absolute');
    });
  });
});

// MasonItemDirective
// ————————————————————————————————————————————————————————————————————————————

describe('MasonItemDirective', () => {
  afterEach(() => {
    uninstallMock();
    TestBed.resetTestingModule();
  });

  async function makeFixture(margin = 0, opts?: MasontreeOptions) {
    installMock({ width: 400 }, { width: 80, height: 80 });
    await TestBed.configureTestingModule({ imports: [MasonItemHost] }).compileComponents();
    const fixture = TestBed.createComponent(MasonItemHost);
    fixture.componentInstance.margin = margin;
    if (opts) fixture.componentInstance.opts = opts;
    fixture.detectChanges();
    await flushLayout();
    return fixture;
  }

  it('writes __masonMargin onto the element', async () => {
    const fixture = await makeFixture(20);
    const el = fixture.nativeElement.querySelector('#r1') as any;
    expect(el.__masonData).toStrictEqual({ margin: 20, locked: false, x: 0, y: 0 });
  });

  it('updates __masonMargin when input changes', async () => {
    const fixture = await makeFixture(10);
    const el = fixture.nativeElement.querySelector('#r1') as any;

    expect(el.__masonData).toStrictEqual({ margin: 10, locked: false, x: 0, y: 0 });
    fixture.componentInstance.margin = 40;
    fixture.changeDetectorRef.detectChanges(); // fixture.detectChanges() fails here
    expect(el.__masonData).toStrictEqual({ margin: 40, locked: false, x: 0, y: 0 });
  });

  it('clamps negative margin to 0', async () => {
    const fixture = await makeFixture(-5);
    const el = fixture.nativeElement.querySelector('#r1') as any;
    expect(el.__masonData).toStrictEqual({ margin: 0, locked: false, x: 0, y: 0 });
  });

  it('flush rects (margin 0, gap 0) touch each other', async () => {
    const fixture = await makeFixture(0, { gap: 0, iterations: 0 });
    const r1 = fixture.nativeElement.querySelector('#r1') as HTMLElement;
    const r2 = fixture.nativeElement.querySelector('#r2') as HTMLElement;
    expect(getX(r2)).toBe(getX(r1) + 80);
  });

  it('per-rect margin overrides global gap (largest wins)', async () => {
    const fixture = await makeFixture(30, { gap: 10, iterations: 0 });
    const r1 = fixture.nativeElement.querySelector('#r1') as HTMLElement;
    const r2 = fixture.nativeElement.querySelector('#r2') as HTMLElement;
    // gap = max(30, 30) = 30
    expect(getX(r2)).toBe(getX(r1) + 80 + 30);
  });
});
