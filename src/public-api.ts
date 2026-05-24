// Public API surface for @your-org/masontree
//
// Import the component into any standalone component or NgModule:
//
//   import { MasonTreeComponent } from '@your-org/masontree';
//
// Or import the low-level algorithm classes directly:
//
//   import { MasonTree, MasonTreeWithLayout } from '@your-org/masontree';

export { MasonTreeComponent }        from './lib/masontree.component';
export type { MasonTreeOptions }     from './lib/masontree.component';

export { MasonTreeWithLayout, LayoutMixin } from './lib/mason-tree-layout';
export type { PullOptions, PullOptionsResolver, PullDirection } from './lib/mason-tree-layout';

export { MasonTree, Rect }            from './lib/mason-tree';
export type { RectInit, ObstructionResult, Axis, Direction } from './lib/mason-tree';
