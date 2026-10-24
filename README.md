# tonto playground

[tonto](https://github.com/nemo-ufes/tonto) in the browser: one `.tonto`
file in an editor on the left, its OntoUML diagram on the right, drawn as you
type. No install, no account, and no server — the model never leaves the page
unless you share a link, and a link carries the model in its fragment, which
browsers do not send anywhere.

It is the same language and the same diagram as in VS Code. The editor talks to
tonto's own language server, running in a web worker, so the checks, the
explanations and the repairs are the ones the
[tonto extension](https://marketplace.visualstudio.com/items?itemName=nemo-ufes.tonto-vscode)
gives. The diagram is the
[tonto visualizer](https://github.com/nemo-ufes/tonto-visualizer)'s panel,
arranged the same way and arranged by hand the same way.

## What you can do

- **Write a model** with completion, hover, problems as you type, quick fixes,
  rename, formatting and semantic highlighting.
- **Watch the diagram follow.** A class you add is placed without moving what
  you placed; while the text does not parse, the last picture stays, with the
  line that broke it.
- **Arrange it** by dragging, or with Arrange; hide classes and associations;
  choose what is drawn. Undo and redo in the diagram take back diagram changes;
  the editor's undo takes back text.
- **Move between the two**: the cursor in a declaration selects its element;
  double-clicking an element puts the cursor on its declaration.
- **Start from an example**: tonto's catalog of modeling patterns, each a small
  model that checks without a problem.
- **Keep or share it**: the text and arrangement survive a reload; Download
  saves the `.tonto` file; Copy link makes a link holding the model and its
  arrangement; Export writes SVG, PNG, or the arrangement as a `.tontoview`
  file the visualizer in VS Code opens beside the model.

One file only: `package … in`, `use` and `import` of other files do not
resolve here. For an ontology of several files, use VS Code.

## Developing

Node.js 22 or later.

    git clone --recurse-submodules https://github.com/nemo-ufes/tonto-playground
    cd tonto-playground
    npm install
    npm run upstream     # build tonto and the visualizer from the submodule
    npm run dev

    npm test             # language, examples, relay, share links
    npm run test:e2e     # the built page, in Chromium
    npm run build        # dist/, ready for any static host

Pushes to `main` are built, tested and published to GitHub Pages by
`.github/workflows/pages.yml`. [docs/PLAN.md](docs/PLAN.md) records the design
and the decisions behind it; [AGENTS.md](AGENTS.md) the rules for changing it.

## Acknowledgements

tonto's language design, concrete syntax, and OntoUML/UFO semantics are the
work of the [NEMO Ontology & Conceptual Modeling research group](https://nemo.inf.ufes.br),
in cooperation with the [Semantics, Cybersecurity & Services (SCS) group](https://www.utwente.nl/en/eemcs/scs/),
as described in the [tonto](https://github.com/nemo-ufes/tonto) and
[tonto visualizer](https://github.com/nemo-ufes/tonto-visualizer) repositories.

## Licence

MIT. See [LICENSE](LICENSE). The built page bundles third-party packages,
listed with their licences in `THIRD-PARTY-NOTICES.txt` beside it; the ELK
layout engine is used under the Eclipse Public License 2.0.
