/**
 * The worker's language, without the worker: the same services, the same
 * empty file system and the same document URI, built the way the server
 * builds after `didChange`.
 */

import type { LangiumDocument } from 'langium';
import { EmptyFileSystem, URI } from 'langium';
import { createTontoServices } from 'tonto-language/core';
import { DOCUMENT_URI } from '../src/language/protocol.js';

export async function session() {
    const services = createTontoServices(EmptyFileSystem);
    await services.shared.workspace.WorkspaceManager.initializeWorkspace([]);
    const documents = services.shared.workspace.LangiumDocuments;
    const uri = URI.parse(DOCUMENT_URI);
    return {
        services,
        async open(text: string): Promise<LangiumDocument> {
            if (documents.hasDocument(uri)) {
                documents.deleteDocument(uri);
            }
            const document = services.shared.workspace.LangiumDocumentFactory.fromString(text, uri);
            documents.addDocument(document);
            await services.shared.workspace.DocumentBuilder.build([document], { validation: true });
            return document;
        }
    };
}
