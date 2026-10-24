// The language, the diagram derivation, the canvas and the panel come from the
// pinned tonto-visualizer submodule, which pins tonto in turn: one language
// version, the one the diagram was built and tested against.
//
//   node scripts/upstream.mjs build   build both, in the submodule's own way
//   node scripts/upstream.mjs link    make them resolvable from this package
//
// `link` puts symlinks in node_modules rather than declaring `file:`
// dependencies, because npm installs a linked folder's dependencies into that
// folder, and the submodule's node_modules is the submodule's business. The
// links point where the visualizer's own workspace links point, so a module is
// one module whichever side imports it.

import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readlinkSync, rmSync, symlinkSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const visualizer = join(root, 'vendor', 'tonto-visualizer');

const LINKS = {
    'tonto-language': join(visualizer, 'vendor', 'tonto', 'packages', 'language'),
    'tonto-view': join(visualizer, 'packages', 'view'),
    'tonto-canvas': join(visualizer, 'packages', 'canvas'),
    'tonto-visualizer': join(visualizer, 'packages', 'extension')
};

function run(command, args, cwd) {
    const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
    if (result.status !== 0) {
        throw new Error(`${command} ${args.join(' ')} failed in ${relative(root, cwd) || '.'}`);
    }
}

function build() {
    if (!existsSync(join(visualizer, 'package.json'))) {
        throw new Error('vendor/tonto-visualizer is empty: run git submodule update --init --recursive');
    }
    run('npm', ['run', 'language'], visualizer);
    run('npm', ['ci', '--no-audit', '--no-fund'], visualizer);
    run('npm', ['run', 'build'], visualizer);
}

function link() {
    const modules = join(root, 'node_modules');
    mkdirSync(modules, { recursive: true });
    for (const [name, target] of Object.entries(LINKS)) {
        const path = join(modules, name);
        if (existsSync(path) || isLink(path)) {
            if (isLink(path) && resolve(modules, readlinkSync(path)) === target) continue;
            rmSync(path, { recursive: true, force: true });
        }
        // A junction on Windows needs no developer mode, and a directory link is all this is.
        symlinkSync(relative(modules, target), path, 'junction');
    }
    if (!existsSync(join(LINKS['tonto-language'], 'out', 'core.js'))) {
        console.warn('tonto-playground: the submodule is not built yet; run npm run upstream');
    }
}

function isLink(path) {
    try { return lstatSync(path).isSymbolicLink(); } catch { return false; }
}

const command = process.argv[2];
if (command === 'build') {
    build();
    link();
} else if (command === 'link') {
    link();
} else {
    console.error('usage: node scripts/upstream.mjs build|link');
    process.exit(2);
}
