/**
 * The tonto language server, in a web worker.
 *
 * It is the server the VS Code extension runs, with `EmptyFileSystem` where
 * the extension has the disk: every editor feature tonto offers comes through
 * Monaco's LSP client unchanged. Beside it, after each build the worker reads
 * the document as a diagram and sends that to the page, so the AST stays here
 * and the page receives plain data -- the same `ViewModel` the extension's
 * host hands its panel.
 */

import type { LangiumDocument } from 'langium';
import { DocumentState, EmptyFileSystem } from 'langium';
import { startLanguageServer } from 'langium/lsp';
import { createTontoServices } from 'tonto-language/core';
import type { ContentOptions } from 'tonto-view';
import { defaultContentOptions } from 'tonto-view';
import { BrowserMessageReader, BrowserMessageWriter, createConnection } from 'vscode-languageserver/browser';
import type { FromWorker, ToWorker, WorkerStart } from './protocol.js';
import { DOCUMENT_URI } from './protocol.js';
import { viewOf } from './view.js';

addEventListener('message', function start(event: MessageEvent<WorkerStart>) {
    if (event.data?.type !== 'start') {
        return;
    }
    removeEventListener('message', start);
    serve(event.data.lsp, event.data.view);
});

function serve(lsp: MessagePort, view: MessagePort): void {
    const connection = createConnection(new BrowserMessageReader(lsp), new BrowserMessageWriter(lsp));
    const { shared, Tonto } = createTontoServices({ connection, ...EmptyFileSystem });
    startLanguageServer(shared);

    let content: ContentOptions = defaultContentOptions;
    let latest: LangiumDocument | undefined;
    const send = (): void => {
        if (latest) {
            const message: FromWorker = { type: 'view', ...viewOf(latest, Tonto, content) };
            view.postMessage(message);
        }
    };

    // Validated, not Linked: the page shows diagnostics and diagram together,
    // and a diagram that runs ahead of the squiggles reads as a disagreement.
    shared.workspace.DocumentBuilder.onBuildPhase(DocumentState.Validated, documents => {
        const document = documents.find(candidate => candidate.uri.toString() === DOCUMENT_URI);
        if (document) {
            latest = document;
            send();
        }
    });

    view.onmessage = (event: MessageEvent<ToWorker>) => {
        if (event.data.type === 'content') {
            content = event.data.content;
            send();
        }
    };
}
