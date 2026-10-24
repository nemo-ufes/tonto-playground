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
 */

import type { Diagnostic } from 'vscode-languageserver-types';

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
    /** What the server last published, by document URI as the client spells it. */
    private readonly published = new Map<string, Diagnostic[]>();

    /** A message on its way from the server to the client. */
    fromServer(data: unknown): unknown {
        const message = data as Message;
        if (message?.method === 'textDocument/publishDiagnostics') {
            const params = message.params as { uri: string; diagnostics: Diagnostic[] };
            this.published.set(params.uri.toLowerCase(), params.diagnostics);
            return data;
        }
        if (message?.jsonrpc && message.id !== undefined && message.id !== null
            && message.error && CANCELLED.has(message.error.code ?? 0)) {
            return { jsonrpc: message.jsonrpc, id: message.id, result: null };
        }
        return data;
    }

    /** A message on its way from the client to the server. */
    fromClient(data: unknown): unknown {
        const message = data as Message;
        if (message?.method !== 'textDocument/codeAction') {
            return data;
        }
        const params = message.params as {
            textDocument: { uri: string };
            context: { diagnostics: Diagnostic[] };
        };
        const published = this.published.get(params.textDocument.uri.toLowerCase()) ?? [];
        const diagnostics = params.context.diagnostics.map(asked =>
            published.find(candidate => sameDiagnostic(candidate, asked)) ?? asked);
        return { ...message, params: { ...params, context: { ...params.context, diagnostics } } };
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

/** Puts a relay between the server's port and a new one for the client. */
export function relay(server: MessagePort): MessagePort {
    const relay = new LspRelay();
    const channel = new MessageChannel();
    server.onmessage = event => channel.port1.postMessage(relay.fromServer(event.data));
    channel.port1.onmessage = event => server.postMessage(relay.fromClient(event.data));
    return channel.port2;
}
