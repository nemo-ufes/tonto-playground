import { describe, expect, test } from 'vitest';
import { linkTo, sharedIn } from '../src/share.js';
import { DEFAULT_MODEL } from '../src/default-model.js';

describe('a model in a link', () => {
    test('comes back exactly as it went, arrangement included', () => {
        const view = JSON.stringify({ version: 1, nodes: { 'people::Person': { x: 10, y: 20 } } });
        const link = linkTo({ text: DEFAULT_MODEL, view }, 'https://example.org/playground/');
        expect(link.startsWith('https://example.org/playground/#model=')).toBe(true);
        expect(sharedIn(new URL(link).hash)).toEqual({ text: DEFAULT_MODEL, view });
    });

    test('is nothing when the link carries no model, or a damaged one', () => {
        expect(sharedIn('')).toBeUndefined();
        expect(sharedIn('#something=else')).toBeUndefined();
        expect(sharedIn('#model=%%%')).toBeUndefined();
    });
});
