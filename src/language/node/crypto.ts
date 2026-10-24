/**
 * `node:crypto` for a page. The language hashes only to key and check its
 * import cache and names only temporary files, and a page has neither.
 */

export function randomUUID(): string {
    return globalThis.crypto.randomUUID();
}

/**
 * Not SHA-256. A digest is compared only with digests made here, in the cache
 * a page never has; it is FNV-1a so that a call still returns something
 * stable rather than throwing in the middle of a build.
 */
export function createHash(_algorithm: string) {
    let text = '';
    const hash = {
        update(chunk: string) {
            text += chunk;
            return hash;
        },
        digest(_encoding?: string): string {
            let value = 0x811c9dc5;
            for (let index = 0; index < text.length; index++) {
                value ^= text.charCodeAt(index);
                value = Math.imul(value, 16777619);
            }
            return (value >>> 0).toString(16).padStart(8, '0');
        }
    };
    return hash;
}
