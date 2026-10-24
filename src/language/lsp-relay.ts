/**
 * Between the language server and Monaco's LSP client: two places where that
 * client does not speak LSP the way VS Code's does, and tonto depends on it.
 *
 * 1. A request the server cancels. Monaco asks for code actions in the same
 *    moment it opens the document, the request can arrive first, and the
 *    server answers "cancelled" -- the protocol's way of saying "ask again".
 *    VS Code's client does; Monaco's throws it into the page. Here it becomes
 *    an empty answer, and the next cursor move asks again.
 *
 * 2. The diagnostics a code action is asked about. Monaco's client rebuilds
 *    them from its editor markers, which keep the range, message and severity
 *    and lose `code` and `data`. tonto chooses a repair by the diagnostic's
 *    code, so without it every quick fix silently disappears. The relay has
 *    seen what the server published, and puts the code back.
 *
 * And one place where the playground is not a workspace: there is one
 * document. A code action that would write another file -- splitting an
 * ontology into a file and a package -- has nowhere to write it, and Monaco's
 * client throws on an edit to a document it does not have. So does it on
 * diagnostics for the language's built-in datatypes, which no editor shows.
 * The relay passes on only what concerns the playground's document.
 */

import type { Diagnostic, WorkspaceEdit } from 'vscode-languageserver-types';

/** LSP's RequestCancelled and ServerCancelled. */
const CANCELLED = new Set([-32800, -32802]);

interface Message {
    jsonrpc?: string;
    id?: number | string | null;
    method?: string;
    params?: unknown;
    error?: { code?: number };
}

export class LspRelay {
    /** What the server last published for the document. */
    private published: Diagnostic[] = [];
    /** Code action requests still waiting for their answer. */
    private readonly codeActionRequests = new Set<number | string>();

    /** @param document the one document there is, as the client spells its URI */
    constructor(private readonly document: string) {}

    /**
     * A message on its way from the server to the client, or `undefined` when
     * it should not arrive at all.
     */
    fromServer(data: unknown): unknown {
        const message = data as Message & { result?: unknown };
        if (message?.method === 'textDocument/publishDiagnostics') {
            const params = message.params as { uri: string; diagnostics: Diagnostic[] };
            if (!this.isDocument(params.uri)) {
                return undefined;
            }
            this.published = params.diagnostics;
            return data;
        }
        if (message?.jsonrpc && message.id !== undefined && message.id !== null
            && message.error && CANCELLED.has(message.error.code ?? 0)) {
            this.codeActionRequests.delete(message.id);
            return { jsonrpc: message.jsonrpc, id: message.id, result: null };
        }
        if (message?.id !== undefined && message.id !== null && this.codeActionRequests.delete(message.id)
            && Array.isArray(message.result)) {
            return { ...message, result: message.result.filter(action => this.touchesOnlyDocument(action)) };
        }
        return data;
    }

    /** A message on its way from the client to the server. */
    fromClient(data: unknown): unknown {
        const message = data as Message;
        if (message?.method !== 'textDocument/codeAction') {
            return data;
        }
        if (message.id !== undefined && message.id !== null) {
            this.codeActionRequests.add(message.id);
        }
        const params = message.params as {
            textDocument: { uri: string };
            context: { diagnostics: Diagnostic[] };
        };
        const published = this.isDocument(params.textDocument.uri) ? this.published : [];
        const diagnostics = params.context.diagnostics.map(asked =>
            published.find(candidate => sameDiagnostic(candidate, asked)) ?? asked);
        return { ...message, params: { ...params, context: { ...params.context, diagnostics } } };
    }

    private isDocument(uri: string): boolean {
        return uri.toLowerCase() === this.document.toLowerCase();
    }

    /** A command, or an action whose edit changes this document and nothing else. */
    private touchesOnlyDocument(action: unknown): boolean {
        const edit = (action as { edit?: WorkspaceEdit }).edit;
        if (!edit) {
            return true;
        }
        const changed = Object.keys(edit.changes ?? {});
        for (const change of edit.documentChanges ?? []) {
            if (!('textDocument' in change)) {
                // Creating, renaming or deleting a file.
                return false;
            }
            changed.push(change.textDocument.uri);
        }
        return changed.every(uri => this.isDocument(uri));
    }
}

/** Range and message: what the marker kept of what the server said. */
function sameDiagnostic(published: Diagnostic, asked: Diagnostic): boolean {
    return published.message === asked.message
        && published.range.start.line === asked.range.start.line
        && published.range.start.character === asked.range.start.character
        && published.range.end.line === asked.range.end.line
        && published.range.end.character === asked.range.end.character;
}

/**
 * Puts a relay between the server's port and a new one for the client.
 *
 * `onDiagnostics` hears every set the server publishes for the document,
 * including an empty one: the editor's markers say nothing when a model that
 * had no problems still has none, so they cannot say "checked, and clean".
 */
export function relay(
    server: MessagePort, document: string, onDiagnostics: (diagnostics: Diagnostic[]) => void
): MessagePort {
    const relay = new LspRelay(document);
    const channel = new MessageChannel();
    server.onmessage = event => {
        const message = relay.fromServer(event.data);
        if (message !== undefined) {
            channel.port1.postMessage(message);
            const published = message as Message;
            if (published.method === 'textDocument/publishDiagnostics') {
                onDiagnostics((published.params as { diagnostics: Diagnostic[] }).diagnostics);
            }
        }
    };
    channel.port1.onmessage = event => server.postMessage(relay.fromClient(event.data));
    return channel.port2;
}
