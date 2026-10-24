/**
 * A model in a link: the text, and its arrangement when it has one, compressed
 * into the URL's fragment. The fragment never leaves the browser -- it is not
 * sent with the request -- so a shared model reaches no server, this one's
 * included.
 */

import { compressToEncodedURIComponent, decompressFromEncodedURIComponent } from 'lz-string';

export interface Shared {
    text: string;
    /** A `.tontoview` file's JSON, when the diagram had been arranged. */
    view?: string;
}

export function linkTo(shared: Shared, base = location.href): string {
    const url = new URL(base);
    const parts = [`model=${compressToEncodedURIComponent(shared.text)}`];
    if (shared.view) {
        parts.push(`view=${compressToEncodedURIComponent(shared.view)}`);
    }
    url.hash = parts.join('&');
    return url.href;
}

/** What a link carries, or nothing when it carries no model or a damaged one. */
export function sharedIn(hash: string): Shared | undefined {
    const parameters = new URLSearchParams(hash.replace(/^#/, ''));
    const model = parameters.get('model');
    if (!model) {
        return undefined;
    }
    const text = decompressFromEncodedURIComponent(model);
    if (!text) {
        return undefined;
    }
    const view = parameters.get('view');
    const arrangement = view ? decompressFromEncodedURIComponent(view) : undefined;
    return { text, ...(arrangement ? { view: arrangement } : {}) };
}
