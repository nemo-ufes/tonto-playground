/**
 * The page's side of the language worker: a port for Monaco's LSP client,
 * and the diagram updates that arrive beside it.
 */

import type { ContentOptions } from 'tonto-view';
import { relay } from './lsp-relay.js';
import type { Example, FromWorker, ToWorker, ViewUpdate, WorkerStart } from './protocol.js';
import { DOCUMENT_URI } from './protocol.js';

export interface LanguageWorker {
    /**
     * Carries JSON-RPC only, through the relay in lsp-relay.ts. Hand it to the
     * LSP client and nothing else.
     */
    readonly lsp: MessagePort;
    onView(listener: (update: ViewUpdate) => void): void;
    /** How many errors and warnings the server reports, each time it checks. */
    onProblems(listener: (errors: number, warnings: number) => void): void;
    /** Called once, when the worker has the pattern catalog. */
    onExamples(listener: (examples: Example[]) => void): void;
    setContent(content: ContentOptions): void;
}

export function startLanguageWorker(): LanguageWorker {
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'tonto-language' });
    const lsp = new MessageChannel();
    const view = new MessageChannel();
    const start: WorkerStart = { type: 'start', lsp: lsp.port2, view: view.port2 };
    worker.postMessage(start, [lsp.port2, view.port2]);

    const problemListeners: Array<(errors: number, warnings: number) => void> = [];
    const lspPort = relay(lsp.port1, DOCUMENT_URI, diagnostics => {
        const errors = diagnostics.filter(diagnostic => diagnostic.severity === 1).length;
        const warnings = diagnostics.filter(diagnostic => diagnostic.severity === 2).length;
        for (const listener of problemListeners) {
            listener(errors, warnings);
        }
    });

    const listeners: Array<(update: ViewUpdate) => void> = [];
    const exampleListeners: Array<(examples: Example[]) => void> = [];
    let examples: Example[] | undefined;
    view.port1.onmessage = (event: MessageEvent<FromWorker>) => {
        if (event.data.type === 'view') {
            const { type: _type, ...update } = event.data;
            for (const listener of listeners) {
                listener(update);
            }
        } else if (event.data.type === 'patterns') {
            examples = event.data.patterns;
            for (const listener of exampleListeners) {
                listener(examples);
            }
        }
    };
    return {
        lsp: lspPort,
        onView: listener => {
            listeners.push(listener);
        },
        onProblems: listener => {
            problemListeners.push(listener);
        },
        onExamples: listener => {
            exampleListeners.push(listener);
            if (examples) {
                listener(examples);
            }
        },
        setContent: content => {
            const message: ToWorker = { type: 'content', content };
            view.port1.postMessage(message);
        }
    };
}

