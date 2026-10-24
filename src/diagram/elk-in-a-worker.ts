/**
 * Imported first by the layout worker, before ELK loads.
 *
 * ELK's bundle decides what it is by looking around: with no `document` and a
 * `self`, it takes itself to be ELK's own web worker, answers `self.onmessage`
 * and exports nothing -- and `tonto-canvas`, which constructs ELK and lays out
 * in the same thread, gets "is not a constructor". An empty `document` makes
 * it export the layouter. Nothing else in this worker reads `document`.
 */

(globalThis as { document?: unknown }).document ??= {};

export {};
