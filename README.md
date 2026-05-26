# masontree

An Angular layout component that packs its direct children using a 2-D
bin-packing algorithm backed by functional red-black trees, then runs an
iterative repositioning pass to even out the spacing.

## Installation

```bash
npm install masontree functional-red-black-tree
npm install --save-dev @types/functional-red-black-tree
```

## Basic usage

```html
<masontree [opts]="options">
  <div style="width: 200px; height: 302px">Rectangle #1</div>
  <div style="width: 102px; height: 120px">Rectangle #2</div>
  <div style="width: 240px; height: 200px">Rectangle #3</div>
</masontree>
```

```ts
import { Component } from '@angular/core';
import { MasonTreeComponent, MasonTreeOptions } from 'masontree';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [MasonTreeComponent],
  template: `
    <masontree [opts]="options" style="width: 800px; background: #f5f5f5;">
      <div *ngFor="let item of items"
           [style.width.px]="item.w"
           [style.height.px]="item.h"
           style="background: steelblue; border-radius: 4px;">
        {{ item.label }}
      </div>
    </masontree>
  `,
})
export class AppComponent {
  options: MasonTreeOptions = {
    gap:          12,   // px of breathing room around each item
    iterations:   8,    // repositioning passes
    positionMode: 'top-transform',
    pull: {
      pullXValue: 0,    // centre horizontally
      pullYValue: 0,    // centre vertically
    },
  };

  items = [
    { w: 200, h: 120, label: 'A' },
    { w: 140, h: 200, label: 'B' },
    { w: 260, h:  80, label: 'C' },
  ];
}
```

## How it works

1. The component measures its own width via `ResizeObserver`.
2. It measures each direct child's width and height.
3. It runs the greedy bin-packing algorithm (MasonTree) to find non-overlapping
   positions for all children within the container width.
4. It runs `iterativelyAdjustRectangles` to spread items out evenly.
5. It writes `top` / `transform` (or `left` / `transform`, depending on
   `positionMode`) back to each child element.
6. It sets the host element's `height` to match the packed content.
7. Steps 1–6 repeat whenever the container or any child changes size, or
   whenever children are added/removed.

The **height** of the container is always derived from the algorithm.
The **width** is always taken from the host element as-is.
You style the width however you like (fixed, `100%`, `max-width`, etc.).

## Options (`MasonTreeOptions`)

| Option          | Type                                        | Default          | Description                                                           |
|-----------------|---------------------------------------------|------------------|-----------------------------------------------------------------------|
| `gap`           | `number`                                    | `8`              | Pixels of padding around each item (creates visual spacing)           |
| `iterations`    | `number`                                    | `8`              | Repositioning passes; more = tighter packing, higher CPU cost         |
| `positionMode`  | `'transform' \| 'top-left' \| 'top-transform'` | `'top-transform'` | How positions are written to child elements (see below)               |
| `pull`          | `PullOptions \| (el) => PullOptions`        | centred, no wall | Pull bias per axis; function form receives the child `HTMLElement`    |

### `positionMode`

| Mode              | Written styles                                              | Notes                        |
|-------------------|-------------------------------------------------------------|------------------------------|
| `'top-transform'` | `top: ${y}px; transform: translateX(${x}px)`               | **Default.** GPU-friendly.   |
| `'transform'`     | `transform: translate(${x}px, ${y}px)`                     | Single property, compositor. |
| `'top-left'`      | `top: ${y}px; left: ${x}px`                                | Triggers layout, avoid if animating. |

### `PullOptions`

| Option            | Type      | Default | Description                                          |
|-------------------|-----------|---------|------------------------------------------------------|
| `pullX`           | `boolean` | `true`  | Adjust horizontal position                           |
| `pullY`           | `boolean` | `true`  | Adjust vertical position                             |
| `pullXValue`      | `number`  | `0`     | Bias in [-1, 1]: -1 = left, 0 = centre, +1 = right |
| `pullYValue`      | `number`  | `0`     | Bias in [-1, 1]: -1 = top, 0 = centre, +1 = bottom |
| `stickyLeftWall`  | `boolean` | `false` | Snap to left edge when nothing obstructs             |
| `stickyTopWall`   | `boolean` | `false` | Snap to top edge when nothing obstructs              |
| `stickyRightWall` | `boolean` | `false` | Snap to right edge when nothing obstructs            |
| `stickyBottomWall`| `boolean` | `false` | Snap to bottom edge when nothing obstructs           |

### Per-item pull via function

```ts
options: MasonTreeOptions = {
  pull: (el: HTMLElement) => ({
    pullXValue: el.classList.contains('hero') ? -1 : 0,  // hero items hug the left
    stickyLeftWall: el.classList.contains('hero'),
  }),
};
```

## Programmatic use (no Angular)

The core algorithm is framework-agnostic:

```ts
import { MasonTreeWithLayout } from 'masontree';

const tree = new MasonTreeWithLayout(800 /* container width */);
tree.addRect(
  { id: 'a', x: 0, y: 0, w: 200, h: 120 },
  { id: 'b', x: 0, y: 0, w: 140, h: 200 },
);
tree.iterativelyAdjustRectangles(8, { pullXValue: 0, pullYValue: -1 });

for (const [id, rect] of tree.rects) {
  console.log(id, rect.x, rect.y);
}
```

## Building the library

```bash
npm install
npm run build
# output → dist/masontree/
```

In your consuming application, point to the dist folder or publish to npm:

```json
// consuming app's package.json
{
  "dependencies": {
    "masontree": "file:../masontree/dist/masontree"
  }
}
```
