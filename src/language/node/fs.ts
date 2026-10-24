/**
 * `node:fs` for a page with no files.
 *
 * The language reaches the file system for `tonto.json`, the import cache and
 * sibling `.tonto` files -- none of which exists for one document in a
 * browser. So nothing exists, a path is its own real path, and anything that
 * would write says why it cannot rather than pretending to.
 */

function unavailable(name: string): never {
    throw new Error(`${name}: there is no file system in the playground`);
}

export function existsSync(_path: string): boolean {
    return false;
}

export const realpathSync = Object.assign((path: string) => path, { native: (path: string) => path });

export function readFileSync(path: string): never {
    return unavailable(`readFileSync(${path})`);
}

export function lstatSync(path: string): never {
    return unavailable(`lstatSync(${path})`);
}

export function mkdirSync(path: string): never {
    return unavailable(`mkdirSync(${path})`);
}

export function writeFileSync(path: string): never {
    return unavailable(`writeFileSync(${path})`);
}

export function renameSync(path: string): never {
    return unavailable(`renameSync(${path})`);
}

export function unlinkSync(path: string): never {
    return unavailable(`unlinkSync(${path})`);
}
