# Design notes

**`tonto-playground`** is a single-page web application: one `.tonto` file in
an editor on the left, its OntoUML diagram on the right, both in the browser.
There is no install, no account and no server. The model never leaves the page
unless the modeller shares a link.

The playground is the third consumer of two existing repositories, and it does
not reimplement either:

| repository | supplies |
|---|---|
| [`nemo-ufes/tonto`](https://github.com/nemo-ufes/tonto) | `tonto-language`: grammar, validation, language server, gUFO export, patterns |
| [`nemo-ufes/tonto-visualizer`](https://github.com/nemo-ufes/tonto-visualizer) | `tonto-view` (AST → diagram), `tonto-canvas` (layout and SVG), the diagram panel |

This repository supplies the page that holds them together.

---

## 1. Feasibility: what was checked

A throwaway spike bundled the existing packages with esbuild
(`--platform=browser`). It ran the full path text → parse → link → validate →
`derive` → ELK layout → SVG. Nothing in either sibling repository was changed.

| question | answer |
|---|---|
| Does `tonto-language` run without Node? | Yes, with `EmptyFileSystem` and four module substitutions (§3). |
| Does validation behave the same? | Yes. The README's `people.tonto` validates silently. Without `specializes Person`, it reports the expected ultimate-sortal error. |
| Does the diagram pipeline run without Node? | Yes. `tonto-view` has no DOM and no `vscode` import, and `tonto-canvas` already runs in the extension's webview. |
| Speed | 2–9 ms per validation; ~85 ms for derive + layout + render of a five-class model (first run, unwarmed). |
| Size | language + view + canvas + ELK: 2.7 MB minified, ~750 KB gzipped. ELK alone is ~1.5 MB minified. |

The rendered diagram matches what the extension draws for the same model.

## 2. Architecture

```
┌──────────── main thread ─────────────┐     ┌──── language worker ─────┐
│ Monaco editor ◄── LSP (JSON-RPC) ────┼────►│ Langium tonto server     │
│                                      │     │ (EmptyFileSystem)        │
│ Diagram pane (reused panel)  ◄───────┼─────│ after each build:        │
│   ▲ ToPanel / FromPanel protocol     │     │   derive() → ViewModel   │
│ Page host (positions, undo,          │     └──────────────────────────┘
│   saved arrangement, export)         │     ┌──── layout worker ───────┐
│                                      │────►│ ELK autoLayout           │
└──────────────────────────────────────┘     └──────────────────────────┘
```

### 2.1 Editor: Monaco and its own LSP client

The Langium server runs in a web worker. It uses `startLanguageServer` with
`vscode-languageserver/browser`'s `BrowserMessageReader` and
`BrowserMessageWriter`. Every editor feature tonto already provides comes
through unchanged because the providers are LSP-based: diagnostics, quick
fixes, completion, hover, rename, formatting, folding and semantic tokens.

**Changed in implementation:** Monaco has shipped its own LSP client (the
`lsp` namespace) since 0.55, so `monaco-languageclient` and its VS Code API
layers are not used. Monaco's client differs from VS Code's in three ways
tonto depends on, bridged by `src/language/lsp-relay.ts` on the port between
the two:

- a request the server cancels (code actions asked before the document is
  open) becomes an empty answer instead of an exception in the page;
- code action requests get back the diagnostic `code` and `data` that Monaco
  drops when it rebuilds diagnostics from its markers -- tonto picks a repair
  by the code, so without this no quick fix appears;
- with one document, actions that would write other files (splitting an
  ontology into a file and a package) and diagnostics for the built-in
  datatypes document are not passed on.

The document's URI is `file:///playground/model.tonto`: tonto treats any
other scheme as an imported, read-only ontology and offers it no repairs.

Base highlighting is a Monarch grammar whose keyword pattern is read from the
generated TextMate grammar in `tonto/packages/extension/syntaxes/`, and the
language configuration is the extension's own file. Monaco's built-in
languages are replaced with empty modules at build time.

CodeMirror 6 was considered. It is several megabytes lighter, but its LSP
client does not cover code actions or semantic tokens as completely, and quick
fixes are where much of tonto's guidance lives. Monaco also gives modellers who
use VS Code the same editing experience.

### 2.2 The view model is derived in the worker

The worker already holds the linked AST. After each build reaches
`Validated`, it calls `derive()` and sends the `ViewModel`, which is plain
JSON, to the page as a custom notification (`tonto/view`). This has three
effects:

- the AST lives in one place;
- the page receives the same `ViewModel` the extension's host sends its panel;
- "the picture survives a broken parse" works as it does in the extension: when
  the document has parse errors, the worker sends what it could read with the
  error, and the page keeps the last good picture with the error on show.

The worker also sends tonto's pattern catalog once at start, for the Examples
menu: the module holding it imports the whole language, which belongs in the
worker rather than the page's bundle.

### 2.3 Diagram pane: the extension's panel, reused

`tonto-visualizer/packages/extension/src/webview/main.ts` (~1,400 lines:
pan/zoom, drag, routing handles, filters, selection, export rasterising) talks
to its host only through `acquireVsCodeApi().postMessage` and the typed
`ToPanel` / `FromPanel` messages in `protocol.ts`. A VS Code webview is a page in
an iframe, so the playground does the same:

1. Load the panel in an `<iframe>` (or a shadow root) from what the extension
   package exports (§6): `tonto-visualizer/panel/skeleton` (`PANEL_BODY`, the
   page body the extension itself uses), `panel/script` (the built panel) and
   `panel/style`. The playground keeps no copy of the markup.
2. Before it runs, define `acquireVsCodeApi()` to return
   `{ postMessage, getState, setState }` backed by `window.parent.postMessage`
   and `sessionStorage`.
3. Write a **page host** that replaces `diagram-panel.ts` for the playground:
   - hold positions and routes;
   - run `placeNewNodes` and `autoLayout`;
   - keep undo/redo for diagram moves;
   - answer `export` with SVG and PNG downloads;
   - translate `reveal` / `selected` into Monaco selections, and the reverse.

`diagram-panel.ts` imports `vscode` and cannot be reused directly. Its
`vscode`-free helpers are exported for reuse: `panel/protocol` (message
types), `panel/restoration` and `panel/filters`. `view-store.ts` reads and
writes files through `vscode` and is not exported; the page host keeps the
arrangement in `localStorage` instead.

The page host stays in this repository (`src/diagram/host.ts`). It follows
`DiagramPanel` closely, and its one copied helper, `prioritizeRelatorPaths`
(private in the extension), is in `src/diagram/relator-paths.ts` with its
source named. A shared panel package with a `Host` interface would remove
both, but nothing here waits for one.

### 2.4 Layout off the main thread

ELK runs in its own worker, so a large model does not freeze typing. ELK's
bundle decides what it is from its surroundings: with no `document` in a
worker it becomes ELK's own worker and exports nothing, so the layout worker
defines an empty `document` before ELK loads (`src/diagram/elk-in-a-worker.ts`). Rendering uses `tonto-canvas/draw`, the half without
ELK: on the main thread for small diagrams, in a render worker for large ones,
as the extension already does.

### 2.5 App shell

Vite + vanilla TypeScript. **Changed in implementation:** Vite 7, not 8:
npm 11's resolver crashes on the optional `@vitejs/devtools` peer chain that
Vite 8 (and Vitest's dependency on it) brings in; an `overrides` entry keeps
Vitest on the project's Vite. The page is two panes, a draggable divider and a
toolbar. The reused panel is vanilla DOM, so a UI framework would add weight
without removing code. House style follows the sibling repositories: ESM,
4-space indent, `tsc -b`, vitest, no default exports.

## 3. Making `tonto-language` browser-safe

The playground imports the language through `tonto-language/core` (§6),
which leaves out the CLI session API and export writers. What `/core` still
reaches from Node is four modules, all from `publication/workspace.ts` (with
`utils/paths.ts`, `publication/document-validator.ts`,
`lsp/ontology-actions.ts` and `lsp/tonto-file-operation-handler.ts`). That
module deals with multi-file concerns: `tonto.json`, bundles, imports and the
fetch cache. A single-file playground never reaches those paths, so
substitutes are enough, and they stay in this repository's build:

| module | substitute | why it is safe here |
|---|---|---|
| `node:fs` | `existsSync` → `false`; `realpathSync` → identity; writes throw | no `tonto.json`, no cache, no sibling files |
| `node:path` | `pathe`, plus a `posix` export | pure string functions |
| `node:crypto` | `randomUUID` from Web Crypto; any stable string hash for `createHash` | used for cache keys and temp file names only |
| `node:async_hooks` | an `AsyncLocalStorage` that sets a value for the duration of `run` | one document, one build at a time |

`tonto`'s `test/core-entry.test.ts` lists exactly these imports, file by file,
and fails on a new one, so the list cannot grow without tonto's CI noticing.
A bundle of `/core` with only these four substitutes parses, validates and
reads natures with no `process` global at all.

Pins older than the changes in §6 need three more substitutions: an alias
from `tonto-language` to a hand-written barrel (the package root loads
`api.ts`, which imports `langium/node`), a `langium/node` stub, and a
`process` with `cwd: () => '/'` (an unguarded `process.cwd()` in
`configure()`, which the bundler does not catch and which fails at runtime).
Do not build against such pins; they are recorded here only to explain the
history.

## 4. Consuming the sibling code

The constraints:

- `tonto-view` and `tonto-canvas` are private workspace packages, not on npm.
  The panel is part of the extension package (`tonto-visualizer`), which is
  private too; the playground reaches its exports by depending on it as
  `file:vendor/tonto-visualizer/packages/extension`.
- `tonto-view` reads the language through `tonto-language/core` once the
  visualizer change in §6 is merged. Before it, `tonto-view/src/language.ts`
  imports `getEffectiveNatures` and `isUltimateSortal` by path from
  `vendor/tonto/packages/language/out/`.
- The visualizer pins its own tonto submodule. On `main` that is `7cca85f`
  (2026-10-19, tonto 0.9.1); the visualizer branch in §6 moves it to the tonto
  commit that adds `/core` (tonto 0.9.2).
- Two copies of Langium in one bundle break the language at runtime: services
  registered with one copy are invisible to the other.

**Decision (implemented):** `tonto-visualizer` is a git submodule under
`vendor/`, checked out with `--recurse-submodules`, and the playground uses
*its* nested `vendor/tonto`. `scripts/upstream.mjs` builds both the way the
visualizer does and links `tonto-language`, `tonto-view`, `tonto-canvas` and
`tonto-visualizer` into `node_modules` as symlinks to the same folders the
visualizer's own workspace links to; `file:` dependencies would have had npm
install into the submodule.
That is one language version, the one the view was built and tested against,
and one Langium. The build resolves `tonto-language`, `langium`, `chevrotain`
and `vscode-languageserver` to that single copy (Vite `resolve.dedupe` plus
aliases).

The playground pins the visualizer revision and uses the tonto revision nested
inside it. Upgrade those pins only to an already-published visualizer revision
that intentionally carries a compatible tonto pin; do not edit either
submodule's contents as part of a playground dependency update.

## 5. Scope

### First release

All of the following is implemented and covered by the tests in section 8.

- Editor with every LSP feature tonto provides (§2.1).
- Live diagram with the last good picture kept while the text does not parse,
  and the parse problem shown in the diagram's status line, not across the
  canvas.
- Pan/zoom, drag to arrange, automatic arrangement, routing choice, filters.
- Click a class in the diagram to reveal its declaration; move the cursor in
  the editor to select the class in the diagram.
- Export the diagram as SVG and PNG.
- Open a `.tonto` file, download the current text, and download the
  arrangement as a `.tontoview` the extension can read.
- Examples menu built from the patterns catalog (`tonto-language/patterns` uses
  `EmptyFileSystem` already).
- Share link: the model, compressed with `lz-string`, in the URL hash. The hash
  is never sent to a server, which keeps the no-server promise.
- Text and arrangement saved to `localStorage`, so a reload loses nothing.
- Light and dark themes (`tonto-canvas` already has `darkTheme`).

### Later

- gUFO Turtle export in a side tab or as a download (`gufo.ts` has no Node
  imports).
- The language guide and rule tables in a help panel.
- `import <https://…>` resolved by `fetch`, where the host allows cross-origin
  requests.
- Several files in the page (`package … in`, `use`), backed by an in-memory
  `FileSystemProvider`.

### Out of scope

- Anything that writes to a server or stores models remotely.
- Editing the model from the diagram. The visualizer's roadmap excludes it for
  the same reasons.

## 6. Upstream changes

This project consumes pinned revisions of `tonto` and `tonto-visualizer`.
Browser adapters, the four Node substitutes, worker setup and the page host
belong in `tonto-playground`. Upstream changes are kept to what makes the
playground's coupling explicit and tested; none changes tonto's language
semantics or validation behavior, and none should be made to fit the
playground.

### Made: declared entry points and the tests that hold them

These are on branches, committed and not yet pushed or merged. Each is
additive: the VS Code extensions, CLI and MCP server behave as before.

| repository | branch | commit | change |
|---|---|---|---|
| `tonto` | `core-entry` | `75c0544` | `tonto-language/core`: services, AST, relation helpers, `getEffectiveNatures`, `isUltimateSortal`, gUFO export. `test/core-entry.test.ts` fails on a new Node import reached from `/core` or `/patterns`, on a Node-only dependency entry point, and on an unguarded `process` read. `process.cwd()` in `configure()` falls back to `/` where there is no `process`. |
| `tonto-visualizer` | `core-entry-and-panel-exports` | `bc563d2` | Moves the tonto pin to `75c0544`; `tonto-view` reads the language through `/core` instead of by path. |
| `tonto-visualizer` | `core-entry-and-panel-exports` | `7abfaf9` | The panel body moves to `src/webview/skeleton.ts`, shared by the extension and its tests. An `exports` map names `panel/script`, `panel/style`, `panel/skeleton`, `panel/protocol`, `panel/restoration` and `panel/filters`; `test/exports.test.ts` fails if any of them reaches `vscode`; `AGENTS.md` says what the exports promise. |

They land in this order:

1. Merge `tonto`'s `core-entry`. The visualizer's pin names `75c0544`, which
   exists only in a local clone until it is pushed, and the visualizer's CI
   checks submodules out from GitHub. If the merge squashes or rebases, move
   the visualizer pin to the merged commit.
2. Merge the visualizer branch only after tonto's `main` has `/core`: its
   nightly CI builds against tonto's current `main`.
3. Pin the playground to the merged visualizer revision (§4).

### Not needed, and not planned

The stand-ins in §3 and the tests above cover what these would. Propose one
only if it becomes useful for its own repository, with its own review and
tests.

**In `tonto`:**

1. A `/core` with no Node import anywhere in its graph. That needs the next
   two items.
2. File access through an injected service instead of `node:fs` in
   `publication/workspace.ts`, `utils/paths.ts` and `lsp/ontology-actions.ts`.
   Langium's `FileSystemProvider`
   covers reads (`existsSync`, `readFileSync`), but not `realpath`, `lstat` or
   writes. Those must stay, behind a Node implementation the extension, CLI and
   MCP server inject: `realpath` keeps a symlinked import from loading as two
   documents, and `lstat` refuses a symlinked cache directory. The cache hash
   must stay synchronous SHA-256: it is checked while cached imports load, and
   existing `.tonto` caches store it. Web Crypto's `digest` is asynchronous and
   is not a drop-in replacement. `node:path` stays in Node builds, because
   `canonicalPath`'s Windows drive-letter handling depends on it.
3. `validationOntology` passed explicitly or through an injectable context,
   instead of `AsyncLocalStorage`. A plain "current value" variable is correct
   only while every wrapped check is synchronous; the wrapper should fail
   loudly if a check returns a promise, rather than silently validating in the
   wrong ontology's context.

**In `tonto-visualizer`:**

4. Move the panel into a package with a `Host` interface, so the extension and
   the playground share the panel and its host logic instead of the playground
   reimplementing a host.
5. Publish `tonto-view` and `tonto-canvas` (or the shared panel package) to
   npm, so the playground can depend on versions instead of a submodule.

## 7. Milestones

| # | milestone | done when | status |
|---|---|---|---|
| 0 | Scaffold | Vite + TS app builds; submodule in place; one script builds language, view and canvas; a vitest smoke test parses and validates `people.tonto` from the browser bundle. | done |
| 1 | Editor | Monaco talks to the worker; diagnostics, quick fixes, completion, hover, formatting and semantic highlighting work on the examples. | done |
| 2 | Static diagram | The worker sends `ViewModel`s; the page lays them out and draws SVG with pan/zoom; a broken parse keeps the last good picture. | done, together with 3: the reused panel draws |
| 3 | Interactive diagram | Reused panel in the page with the page host: drag, auto-arrange, filters, export, links between editor and diagram in both directions. | done |
| 4 | Playground | Examples, share link, local saving, file open/download, `.tontoview` download, themes. | done, with one pane at a time on a phone |
| 5 | Publish | GitHub Actions builds and deploys to GitHub Pages on every push to `main`. | workflow written; needs the submodule commits pushed (section 6) and Pages enabled |

## 8. Tests

Implemented:

- **Language, in Node with the stand-ins** (`test/language.test.ts`): the
  README model validates silently; a broken one gets the rule's error; a repair
  is offered for the playground's document; the diagram reading has every
  class; a parse error names its line. `tonto`'s own test stops a new Node
  import before it is merged.
- **Every example** (`test/examples.test.ts`): each of the 35 patterns, as the
  Examples menu writes it, validates in silence.
- **The relay and share links** (`test/lsp-relay.test.ts`, `test/share.test.ts`).
- **End-to-end, in Chromium** (`e2e/playground.spec.ts`, against the
  production build): no page errors; a typed class appears without moving
  placed ones; a broken parse keeps the picture and names the line; a quick fix
  applies; editor and diagram select each other; a share link carries the
  arrangement to a fresh browser; an example replaces the text and Undo brings
  it back; export; one pane at a time on a phone. A real browser is the point:
  the `process` global the language once read unguarded passed every test run
  in Node.

Not yet: comparing the worker's `ViewModel` and the exported SVG with
`tonto-view-cli`'s for each example.

## 9. Risks

| risk | effect | mitigation |
|---|---|---|
| A new Node import in `tonto-language` | the browser build breaks on a pin bump | `tonto`'s `core-entry.test.ts` fails on it before it merges (§6); the bundle smoke test (§8) catches the rest |
| Duplicate Langium in the bundle | services silently fail to resolve | dedupe in the build; assert one copy in the smoke test |
| Monaco's LSP client is new (0.55) and differs from VS Code's | an upgrade changes what the relay must bridge | exact version pinned; the relay's tests and the quick-fix end-to-end test fail if it does |
| `relator-paths.ts` drifts from the extension's private copy | Arrange differs between VS Code and the page | the file names its source; drop it for an import if the visualizer exports it |
| Bundle size (~750 KB gzipped core + Monaco) | slow first load on poor connections | load ELK and the layout worker lazily; cache with a service worker |
| `AsyncLocalStorage` substitute | wrong ontology context if builds interleave | keep the shim local; serialize document builds and verify context behavior; an upstream context API is not planned (§6) |
| The panel or its protocol changes in the visualizer | the hosted panel breaks or misreads messages | the playground loads the panel's body, script and protocol from the visualizer's exports, never a copy; the visualizer's tests check every element the panel asks for and that no export reaches `vscode`, and its `AGENTS.md` treats a protocol change as breaking (§6) |
