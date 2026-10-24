/**
 * What the page and the language worker say to each other besides LSP.
 *
 * The worker gets two ports when it starts: one carries the language server's
 * JSON-RPC, which Monaco's LSP client owns, and one carries these messages.
 * Keeping them apart means neither side has to tell a diagram from a
 * response to `textDocument/hover`.
 */

import type { ContentOptions, ViewModel } from 'tonto-view';

/**
 * The one document the playground edits.
 *
 * A `file:` URI although there is no file: the language treats a document
 * under any other scheme as an ontology imported from the web, which is
 * read-only, and offers it no repairs. Lower case, because Monaco's LSP client
 * lower-cases every URI it sends, and the diagram finds the line under the
 * cursor by comparing this with the URI the server wrote into each node.
 */
export const DOCUMENT_URI = 'file:///playground/model.tonto';

/** Sent once, with the ports in its transfer list. */
export interface WorkerStart {
    type: 'start';
    lsp: MessagePort;
    view: MessagePort;
}

/** Page → worker. */
export type ToWorker =
    /** What to draw. The worker derives with it now and after every build. */
    | { type: 'content'; content: ContentOptions };

/** Worker → page. */
export type FromWorker =
    | ({ type: 'view' } & ViewUpdate)
    /**
     * tonto's catalog of modeling patterns, sent once at start: the module
     * that holds it imports the whole language, which is the worker's to load.
     */
    | { type: 'patterns'; patterns: Example[] };

/** A pattern from the catalog, as the Examples menu offers it. */
export interface Example {
    name: string;
    group: string;
    title: string;
    intent: string;
    note: string;
    source: string;
    model: string;
}

export interface ViewUpdate {
    /** The editor's version of the document this was derived from. */
    version: number;
    /**
     * The model as a diagram, with derived material relations and their
     * relators both included: which side is drawn, and what is hidden, is the
     * page's choice, made after this arrives.
     */
    catalog: ViewModel;
    /** Package names the document declares, in order. */
    packages: string[];
    /**
     * Why the text does not parse, with the line. Set, the catalog holds what
     * could still be read, and the page keeps the last good picture instead.
     */
    parseError?: string;
}
