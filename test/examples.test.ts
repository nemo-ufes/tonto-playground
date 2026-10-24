import { describe, expect, test } from 'vitest';
import { PATTERNS } from 'tonto-language/patterns';
import { exampleText } from '../src/examples.js';
import { session } from './language-session.js';

/**
 * An example that opens with a squiggle teaches that the language is fussy,
 * not what the pattern is for. Every one must validate in silence here, with
 * the playground's document and its stand-ins for Node.
 */
describe('the Examples menu', () => {
    test.each(PATTERNS.map(pattern => [pattern.name, pattern] as const))('%s validates in silence', async (_name, pattern) => {
        const document = await (await session()).open(exampleText(pattern));
        const problems = (document.diagnostics ?? [])
            .map(diagnostic => `${diagnostic.code}: ${String(diagnostic.message).split('\n')[0]}`);
        expect(problems).toEqual([]);
    });
});
