import { describe, expect, test } from 'vitest';
import { LspRelay } from '../src/language/lsp-relay.js';

const range = { start: { line: 17, character: 4 }, end: { line: 17, character: 37 } };
const published = {
    range,
    message: 'Mark this end "(const)".',
    severity: 2,
    code: 'dependence-end-not-const',
    source: 'tonto',
    data: { ontology: 'file:///playground/model.tonto' }
};

describe('the relay between the language server and Monaco', () => {
    test('gives a code action request back the code Monaco dropped', () => {
        const relay = new LspRelay('file:///playground/model.tonto');
        relay.fromServer({
            jsonrpc: '2.0', method: 'textDocument/publishDiagnostics',
            params: { uri: 'file:///playground/model.tonto', diagnostics: [published] }
        });
        const asked = relay.fromClient({
            jsonrpc: '2.0', id: 7, method: 'textDocument/codeAction',
            params: {
                textDocument: { uri: 'file:///playground/model.tonto' },
                range,
                context: { diagnostics: [{ range, message: published.message, severity: 2 }], triggerKind: 1 }
            }
        }) as { params: { context: { diagnostics: unknown[]; triggerKind: number } } };
        expect(asked.params.context.diagnostics).toEqual([published]);
        expect(asked.params.context.triggerKind).toBe(1);
    });

    test('leaves a diagnostic it has not seen as it was', () => {
        const relay = new LspRelay('file:///playground/model.tonto');
        const diagnostic = { range, message: 'something else', severity: 1 };
        const asked = relay.fromClient({
            jsonrpc: '2.0', id: 1, method: 'textDocument/codeAction',
            params: { textDocument: { uri: 'file:///playground/model.tonto' }, range, context: { diagnostics: [diagnostic] } }
        }) as { params: { context: { diagnostics: unknown[] } } };
        expect(asked.params.context.diagnostics).toEqual([diagnostic]);
    });

    test('passes on no action that would write a file the playground does not have', () => {
        const relay = new LspRelay('file:///playground/model.tonto');
        relay.fromClient({
            jsonrpc: '2.0', id: 3, method: 'textDocument/codeAction',
            params: { textDocument: { uri: 'file:///playground/model.tonto' }, range, context: { diagnostics: [] } }
        });
        const here = { title: 'Mark the end "const"', edit: { changes: { 'file:///playground/model.tonto': [] } } };
        const split = {
            title: 'Split into an ontology file and package',
            edit: { documentChanges: [{ kind: 'create', uri: 'file:///playground/core.tonto' }] }
        };
        const elsewhere = { title: 'Rename everywhere', edit: { changes: { 'file:///playground/other.tonto': [] } } };
        const answer = relay.fromServer({ jsonrpc: '2.0', id: 3, result: [here, split, elsewhere] }) as { result: unknown[] };
        expect(answer.result).toEqual([here]);
    });

    test('drops diagnostics for documents no editor shows', () => {
        const relay = new LspRelay('file:///playground/model.tonto');
        expect(relay.fromServer({
            jsonrpc: '2.0', method: 'textDocument/publishDiagnostics',
            params: { uri: 'tonto:/builtin/datatypes.tonto', diagnostics: [] }
        })).toBeUndefined();
    });

    test('answers a cancelled request with nothing instead of an error', () => {
        const relay = new LspRelay('file:///playground/model.tonto');
        expect(relay.fromServer({ jsonrpc: '2.0', id: 1, error: { code: -32802, message: 'No document found' } }))
            .toEqual({ jsonrpc: '2.0', id: 1, result: null });
        const failure = { jsonrpc: '2.0', id: 2, error: { code: -32603, message: 'internal' } };
        expect(relay.fromServer(failure)).toBe(failure);
    });
});
