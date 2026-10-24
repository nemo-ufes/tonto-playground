/**
 * `node:path` for a page: POSIX paths, which is what a URI's path already is.
 *
 * `pathe` is Node's path module without Node. The language also asks for
 * `posix` by name, which `pathe` does not export, so it is the module itself.
 */

import * as pathe from 'pathe';

export { basename, dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'pathe';
export const posix = pathe;
