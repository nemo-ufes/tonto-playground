/**
 * A document, read as a diagram: what the visualizer's `ViewSession` does
 * for a workspace, done for the one document the playground holds.
 */

import type { AstNode, LangiumDocument } from 'langium';
import type { TontoServices } from 'tonto-language/core';
import { isModel } from 'tonto-language/core';
import type { ContentOptions, ViewModel } from 'tonto-view';
import { derive, packageName, packagesInScope } from 'tonto-view';
import type { ViewUpdate } from './protocol.js';

const EMPTY: ViewModel = { groups: [], nodes: [], edges: [], gensets: [] };

export function viewOf(document: LangiumDocument, services: TontoServices, content: ContentOptions): ViewUpdate {
    const version = document.textDocument.version;
    const parseError = firstParseError(document);
    const model = document.parseResult.value;
    if (!isModel(model)) {
        return { version, catalog: EMPTY, packages: [], ...(parseError ? { parseError } : {}) };
    }
    const packages = [...new Set(model.packages.map(packageName)
        .filter((name): name is string => name !== undefined))];
    const documentation = services.documentation.DocumentationProvider;
    // Hidden elements and the derived-material choice are applied by the page
    // to this catalog, so they can change without a round trip.
    const { hidden: _hidden, ...unfiltered } = content;
    const catalog = derive({
        models: [model],
        ...(packages[0] ? { focus: packages[0] } : {}),
        documentation: (node: AstNode) => documentation.getDocumentation(node),
        options: {
            ...unfiltered,
            // One document is both "this file" and "the workspace".
            includedPackages: packagesInScope(content, { file: packages, workspace: packages }),
            derivedMaterialMode: 'both'
        }
    });
    return { version, catalog, packages, ...(parseError ? { parseError } : {}) };
}

/**
 * The first parse error, with its line, as the extension shows it: the one
 * place it appears is the diagram's status line, and a message without a line
 * does not say where to look.
 */
function firstParseError(document: LangiumDocument): string | undefined {
    const [error] = document.parseResult.parserErrors;
    if (!error) {
        return undefined;
    }
    const line = error.token.startLine;
    return line !== undefined && Number.isFinite(line) ? `line ${line}: ${error.message}` : error.message;
}
