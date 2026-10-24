import { describe, expect, test } from 'vitest';
import { defaultContentOptions } from 'tonto-view';
import { DOCUMENT_URI } from '../src/language/protocol.js';
import { viewOf } from '../src/language/view.js';
import { session } from './language-session.js';

/** The README's first model: the one a newcomer types first. */
const people = `/// People and their employment.
ontology people

/// A person, in the everyday sense.
kind Person

/// A person employed by an organization.
role Employee specializes Person

/// An organization of people.
kind Organization

/// An organization that employs people.
role Employer specializes Organization

/// The employment binding an employee and an organization.
relator Employment {
    @mediation [1..*] -- [1] (const) Employee
    @mediation [1..*] -- [1] (const) Employer
}

@material relation Employee [1..*] -- worksFor -- [1..*] Employer derivedFrom Employment
`;

describe('the language, with the playground\'s stand-ins for Node', () => {
    test('validates a correct model silently', async () => {
        const document = await (await session()).open(people);
        expect(document.diagnostics ?? []).toEqual([]);
    });

    test('reports a role with no identity provider, with its rule', async () => {
        const broken = people.replace('role Employee specializes Person', 'role Employee');
        const document = await (await session()).open(broken);
        const errors = (document.diagnostics ?? []).filter(diagnostic => diagnostic.severity === 1);
        expect(errors.length).toBeGreaterThan(0);
        expect(errors[0]!.message).toContain('ultimate sortal');
    });

    /**
     * The language offers no repair for a document it takes to be imported
     * from the web, which is any document whose URI is not `file:`. The
     * playground's has to be one, or every quick fix silently disappears.
     */
    test('offers the repairs a rule forces', async () => {
        const playground = await session();
        const document = await playground.open(people.replace('[1] (const) Employee', '[1] Employee'));
        const diagnostic = (document.diagnostics ?? []).find(candidate => candidate.code === 'dependence-end-not-const');
        expect(diagnostic).toBeDefined();
        const actions = await playground.services.Tonto.lsp.CodeActionProvider!.getCodeActions(document, {
            textDocument: { uri: document.uri.toString() },
            range: diagnostic!.range,
            context: { diagnostics: [diagnostic!] }
        });
        expect((actions ?? []).map(action => action.title)).toContain('Mark the end "const"');
    });

    test('reads the model as a diagram with every class and relation', async () => {
        const playground = await session();
        const document = await playground.open(people);
        const update = viewOf(document, playground.services.Tonto, defaultContentOptions);
        expect(update.parseError).toBeUndefined();
        expect(update.catalog.nodes.map(node => node.name).sort())
            .toEqual(['Employee', 'Employer', 'Employment', 'Organization', 'Person']);
        expect(update.catalog.edges.length).toBeGreaterThanOrEqual(5);
        // The diagram finds the line under the cursor by this URI.
        expect(update.catalog.nodes.every(node => node.source?.uri === DOCUMENT_URI)).toBe(true);
    });

    test('says which line does not parse', async () => {
        const playground = await session();
        const document = await playground.open(people.replace('kind Organization', 'kind Organization {'));
        const update = viewOf(document, playground.services.Tonto, defaultContentOptions);
        expect(update.parseError).toMatch(/^line \d+: /);
    });
});
