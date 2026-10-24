import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

/**
 * The four Node modules `tonto-language/core` still reaches, all from the
 * multi-file publication workspace a single-file page never exercises.
 * `tonto`'s test/core-entry.test.ts lists the same four; a fifth fails there
 * before it can reach this build. See docs/PLAN.md, section 3.
 */
const nodeStandIns = ['fs', 'path', 'crypto', 'async_hooks'].map(name => ({
    find: new RegExp(`^node:${name}$`),
    replacement: here(`./src/language/node/${name}.ts`)
}));

/**
 * One copy of each, whichever package imports it. Langium's services are
 * registered with the copy that made them; a second copy in the bundle sees
 * none of them, and the language server answers nothing. These are installed
 * here at the versions tonto pins.
 */
const shared = [
    'langium', 'chevrotain', 'vscode-languageserver', 'vscode-languageserver-protocol',
    'vscode-languageserver-types', 'vscode-jsonrpc', 'vscode-uri', 'elkjs'
];

/**
 * Monaco's entry registers some eighty languages and the TypeScript, CSS,
 * HTML and JSON services. The playground edits one language, whose server
 * runs in its own worker, so those imports become empty modules -- several
 * megabytes the page never loads -- while the editor's features stay.
 */
const monacoWithoutLanguages: Plugin = {
    name: 'monaco-without-languages',
    enforce: 'pre',
    resolveId(source, importer) {
        if (importer?.includes('/monaco-editor/esm/vs/') && /\/languages\/(definitions|features)\//.test(source)) {
            return '\0monaco-without-language';
        }
        return undefined;
    },
    load(id) {
        return id === '\0monaco-without-language' ? 'export {};' : undefined;
    }
};

export default defineConfig({
    // Relative, so the same build serves from a domain root or a GitHub Pages path.
    base: './',
    plugins: [monacoWithoutLanguages],
    // Pre-bundling runs without the plugin above, so the dev server would load
    // a different Monaco from the one that is built and shipped.
    optimizeDeps: {
        exclude: ['monaco-editor']
    },
    resolve: {
        alias: nodeStandIns,
        dedupe: shared
    },
    worker: {
        format: 'es'
    },
    build: {
        target: 'es2022',
        // Monaco and ELK are each larger than Vite's default warning size, and
        // both are needed to show the first screen.
        chunkSizeWarningLimit: 4096
    },
    test: {
        include: ['test/**/*.test.ts']
    }
});
