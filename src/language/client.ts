/**
 * The page's side of the language worker: a port for Monaco's LSP client,
 * and the diagram updates that arrive beside it.
 */

import type { ContentOptions } from 'tonto-view';
import { relay } from './lsp-relay.js';
import type { FromWorker, ToWorker, ViewUpdate, WorkerStart } from './protocol.js';

export interface LanguageWorker {
    /**
     * Carries JSON-RPC only, through the relay in lsp-relay.ts. Hand it to the
     * LSP client and nothing else.
     */
    readonly lsp: MessagePort;
    onView(listener: (update: ViewUpdate) => void): void;
    setContent(content: ContentOptions): void;
}

export function startLanguageWorker(): LanguageWorker {
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'tonto-language' });
    const lsp = new MessageChannel();
    const view = new MessageChannel();
    const start: WorkerStart = { type: 'start', lsp: lsp.port2, view: view.port2 };
    worker.postMessage(start, [lsp.port2, view.port2]);

    const listeners: Array<(update: ViewUpdate) => void> = [];
    view.port1.onmessage = (event: MessageEvent<FromWorker>) => {
        if (event.data.type === 'view') {
            const { type: _type, ...update } = event.data;
            for (const listener of listeners) {
                listener(update);
            }
        }
    };
    return {
        lsp: relay(lsp.port1),
        onView: listener => {
            listeners.push(listener);
        },
        setContent: content => {
            const message: ToWorker = { type: 'content', content };
            view.port1.postMessage(message);
        }
    };
}

