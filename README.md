# ng-masontree

An Angular layout component that packs its direct children using the [Masontree](https://github.com/johntdowney/masontree) bin-packing algorithm, then iteratively repositions them for even spacing. The name is a play on *masonry layout* because ng-masontree provides a similar layout, but without a rigid grid-based approach and handling arbitrarily sized rectangles.

## Installation

```bash
npm install @johntdowney/ng-masontree
```

Requires Angular 21+. No other dependencies required.

## Basic usage

Import the component (and optionally the directive) into your standalone component or NgModule:

```ts
import { MasontreeComponent, MasonItemDirective } from '@johntdowney/ng-masontree';

@Component({
  standalone: true,
  imports: [MasontreeComponent, MasonItemDirective],
  template: `
    <masontree [opts]="{ gap: 12 }">
      <div style="width: 200px; height: 302px">Rectangle #1</div>
      <div style="width: 102px; height: 120px">Rectangle #2</div>
      <div style="width: 240px; height: 200px">Rectangle #3</div>
    </masontree>
  `,
})
export class AppComponent {}
```

The component:
- Measures its own width via `ResizeObserver`
- Measures each direct child's width and height
- Packs them using the Masontree algorithm
- Writes `top` and `transform: translateX(...)` back to each child
- Sets its own `height` to match the packed content
- Re-runs the layout whenever the container or any child changes size, or children are added/removed

The **width** is always taken from the host element — style it however you like (`width: 100%`, a fixed value, etc.). The **height** is always derived from the algorithm output and should not be set in CSS.

## Options

Pass options via the `[opts]` input:

```ts
options: MasontreeOptions = {
  gap:        12,
  iterations: 8,
  transition: 'top 200ms ease, transform 200ms ease',
  pull: {
    pullXValue: 0,   // centre horizontally
    pullYValue: -1,  // push to top
  },
};
```

```html
<masontree [opts]="options" style="width: 100%;">
  ...
</masontree>
```

### `MasontreeOptions`

| Option | Type | Default                                  | Description |
|---|---|------------------------------------------|---|
| `gap` | `number` | `0`                                      | Gap in px between rects. Does not apply at container edges — rects can sit flush with the container walls. See [Gap and margins](#gap-and-margins). |
| `iterations` | `number` | `8`                                      | Number of repositioning passes after initial packing |
| `pull` | `PullOptions \| (el: HTMLElement) => PullOptions` | centered, no wall-snap                   | Pull bias per axis. Function form receives the child `HTMLElement`. |
| `transition` | `string` | `'top 200ms ease, transform 200ms ease'` | CSS transition for position changes. Set to `''` to disable. |

### `PullOptions`

| Option | Type | Default | Description |
|---|---|---|---|
| `pullX` | `boolean` | `true` | Adjust horizontal position |
| `pullY` | `boolean` | `true` | Adjust vertical position |
| `pullXValue` | `number` | `0` | Bias in [-1, 1]: -1 = left wall, 0 = centre, +1 = right wall |
| `pullYValue` | `number` | `0` | Bias in [-1, 1]: -1 = top wall, 0 = centre, +1 = bottom wall |
| `stickyLeftWall` | `boolean` | `false` | Snap to left edge when unobstructed |
| `stickyTopWall` | `boolean` | `false` | Snap to top edge when unobstructed |
| `stickyRightWall` | `boolean` | `false` | Snap to right edge when unobstructed |
| `stickyBottomWall` | `boolean` | `false` | Snap to bottom edge when unobstructed |

## Per-item margins with `[masonItem]`

Use the `MasonItemDirective` on any direct child to give it its own margin, overriding the container's `gap` for that item. The gap between two adjacent rects is `Math.max(rectA.margin, rectB.margin)` — the larger value wins (margin collapsing, same model as CSS).

```html
<masontree [opts]="{ gap: 12 }">
  <div style="width: 200px; height: 150px">normal — 12px gap</div>

  <div masonItem [masonMargin]="32"
       style="width: 200px; height: 150px">
    roomy — 32px gap
  </div>

  <div masonItem [masonMargin]="0"
       style="width: 200px; height: 150px">
    flush — 0px gap
  </div>
</masontree>
```

## Gap and margins

Gap **does not apply at container edges**. A rect at `x=0` or `y=0` sits flush with the container wall regardless of the `gap` setting or `[masonMargin]`. The gap only affects the space between two rects.

```
┌─────────────────────────────┐  ← container wall, no gap here
│┌──────┐  gap  ┌──────┐      │
││ RectA│◄─────►│ RectB│      │
│└──────┘       └──────┘      │
│                             │
└─────────────────────────────┘
```

## Per-item pull via function

```ts
options: MasontreeOptions = {
  pull: (el: HTMLElement) => ({
    // Hero items stick to the left wall; everything else centres
    pullXValue:      el.classList.contains('hero') ? -1 : 0,
    stickyLeftWall:  el.classList.contains('hero'),
  }),
};
```

## Programmatic use

The underlying algorithm is available from the separate `@johntdowney/masontree` package for use outside Angular.

## License

MIT