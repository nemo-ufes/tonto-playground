# Directions for agents

This repository is a page: tonto's language and the tonto visualizer's
diagram, in a browser, beside each other. Both come from elsewhere and are
read, not reimplemented.

## Commands

    git submodule update --init --recursive
    npm install          # also links the submodule's packages into node_modules
    npm run upstream     # builds tonto and the visualizer inside the submodule
    npm run dev          # Vite dev server
    npm run typecheck
    npm test             # vitest: the language, examples, relay, share links
    npm run test:e2e     # Playwright: the built page in Chromium
    npm run build        # dist/, with THIRD-PARTY-NOTICES.txt

## Layout

| | |
|---|---|
| `vendor/tonto-visualizer` | the visualizer, as a pinned submodule; its own `vendor/tonto` pins the language. **Never edited from here.** |
| `src/language` | the language server's worker, the page's side of it, the LSP relay, and the four Node stand-ins |
| `src/editor` | Monaco, with Monaco's own LSP client; highlighting read from tonto's grammar files |
| `src/diagram` | the visualizer's panel in an iframe, the host that answers it, the arrangement store, the layout worker |
| `scripts` | building and linking the submodule; third-party notices |
| `docs/PLAN.md` | what is being built, and the decisions behind it |

## The rules this repository is built on

- **Use what the siblings export.** The language comes through
  `tonto-language/core` and `/patterns`; the panel's body, script, style,
  protocol and helpers through `tonto-visualizer/panel/*`. A copy drifts. The
  one copy kept, `src/diagram/relator-paths.ts`, says where it comes from.
- **The host follows `DiagramPanel`.** `src/diagram/host.ts` is the
  extension's `diagram-panel.ts` for one document. When that file changes, read
  the diff and carry the fix here.
- **Nothing leaves the page.** No server, no analytics, no fonts or scripts
  from elsewhere. A shared model travels in the URL fragment, which is never
  sent.
- **One document.** It is `file:///playground/model.tonto`: tonto offers no
  repairs for documents under other schemes. What would write another file is
  filtered out in the relay.
- **Look at the picture.** Layout and drawing defects are invisible in the
  markup; `npm run test:e2e` drives the page, and a screenshot of it is worth
  taking after any change to the diagram side.

## Updating the pins

Move the visualizer submodule only to a published revision whose own tonto pin
is the one it was tested with, then `npm run upstream`, `npm test` and
`npm run test:e2e`. Do not edit either submodule's contents.

## House style

As in the sibling repositories: comments say why, not what; 4-space indent,
ESM, no default exports (the build configs are the exception their tools
require); domain examples must be true; verify by running.
