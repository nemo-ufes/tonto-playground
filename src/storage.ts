/**
 * `localStorage`, for what a reload should not lose: the text, the
 * arrangement, the theme. Every access can throw -- a private window, blocked
 * site data -- and the playground works the same without it, only forgetting.
 */

const PREFIX = 'tonto-playground:';

export function load(key: string): string | undefined {
    try {
        return localStorage.getItem(PREFIX + key) ?? undefined;
    } catch {
        return undefined;
    }
}

export function save(key: string, value: string | undefined): void {
    try {
        if (value === undefined) {
            localStorage.removeItem(PREFIX + key);
        } else {
            localStorage.setItem(PREFIX + key, value);
        }
    } catch {
        // Nothing to do: the page goes on, and a reload starts afresh.
    }
}
