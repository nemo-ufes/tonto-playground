/**
 * THIRD-PARTY-NOTICES.txt, written into the build from what Rollup actually
 * bundled -- the page and all three workers -- rather than from
 * package-lock.json, which also lists tools that never ship.
 *
 * The rules are tonto-visualizer's (packages/extension/third-party-notices.mjs):
 * the minifier drops the copyright comments of everything it bundles, and
 * MIT, BSD, ISC and Apache-2.0 ask that the notice travel with the code, so
 * each package's license text is collected here. A package under any other
 * license stops the build: shipping copyleft code is a decision to make on
 * purpose. ELK is the one made: it is offered under EPL-2.0 OR
 * GPL-3.0-or-later and taken under the EPL, which asks for its notices, the
 * license text, and a statement of where its source is to be had.
 */

import { readdirSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import type { Plugin } from 'vite';

const PERMISSIVE = new Set([
    '0BSD', 'Apache-2.0', 'BlueOak-1.0.0', 'BSD-2-Clause', 'BSD-3-Clause',
    'CC0-1.0', 'ISC', 'MIT', 'Unlicense', 'Zlib'
]);

const ELECTED = new Map([
    ['elkjs', {
        license: 'EPL-2.0',
        source: (version: string) => `The Source Code of elkjs ${version} is available under the Eclipse Public License 2.0\n`
            + `at https://github.com/kieler/elkjs (release ${version}) and in the npm package elkjs@${version}.`
    }]
]);

const NOTICE_FILE = /^(licen[cs]e|copying|notice|thirdpartynotices)([.-]|$)/i;

/**
 * One collector for the page's build and every worker's: Vite builds workers
 * separately, before the page's bundle is written, and the notices cover all.
 */
export function thirdPartyNotices(): { page: Plugin; worker: Plugin } {
    const modules = new Set<string>();
    const collect: Plugin = {
        name: 'third-party-notices:collect',
        apply: 'build',
        generateBundle(_options, bundle) {
            for (const output of Object.values(bundle)) {
                if (output.type === 'chunk') {
                    for (const id of output.moduleIds) {
                        modules.add(id);
                    }
                }
            }
        }
    };
    const page: Plugin = {
        ...collect,
        name: 'third-party-notices',
        generateBundle(options, bundle, isWrite) {
            (collect.generateBundle as (...args: unknown[]) => void).call(this, options, bundle, isWrite);
            this.emitFile({ type: 'asset', fileName: 'THIRD-PARTY-NOTICES.txt', source: notices(modules) });
        }
    };
    return { page, worker: collect };
}

interface Package {
    root: string;
    name: string;
    version: string;
    license: string | undefined;
    repository: string | undefined;
}

function notices(modules: Iterable<string>): string {
    const packages = new Map<string, Package>();
    for (const id of modules) {
        const root = packageRoot(id.replace(/^\0/, '').replace(/\?.*$/, ''));
        if (!root) {
            continue;
        }
        const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
        const key = `${manifest.name}@${manifest.version}`;
        if (!packages.has(key)) {
            packages.set(key, {
                root,
                name: manifest.name,
                version: manifest.version,
                license: licenseOf(manifest),
                repository: typeof manifest.repository === 'string' ? manifest.repository : manifest.repository?.url
            });
        }
    }
    const sorted = [...packages.entries()].sort(([a], [b]) => a.localeCompare(b));

    const problems: string[] = [];
    for (const [id, pkg] of sorted) {
        const choice = ELECTED.get(pkg.name);
        if (!pkg.license) {
            problems.push(`${id} declares no license`);
        } else if (choice && !offers(pkg.license, choice.license)) {
            problems.push(`${id} is licensed ${pkg.license}, which no longer offers the ${choice.license} it was taken under`);
        } else if (!choice && !satisfies(pkg.license)) {
            problems.push(`${id} is licensed ${pkg.license}, which is not on the permissive list`);
        }
        if (licenseTexts(pkg.root).length === 0) {
            problems.push(`${id} has no license file to copy`);
        }
    }
    if (problems.length > 0) {
        throw new Error(`Third-party licenses need a decision:\n  ${problems.join('\n  ')}`);
    }

    const rule = '-'.repeat(78);
    const sections = sorted.map(([id, pkg]) => {
        const choice = ELECTED.get(pkg.name);
        return [
            [
                id,
                choice ? `License: ${choice.license} (offered as ${pkg.license})` : `License: ${pkg.license}`,
                ...(pkg.repository ? [`Source: ${pkg.repository}`] : [])
            ].join('\n'),
            ...(choice ? [choice.source(pkg.version)] : []),
            ...licenseTexts(pkg.root)
        ].join('\n\n');
    });
    return [
        'Third-party notices',
        '',
        'The tonto playground bundles the following packages. Each is listed with',
        'the license it is distributed under and its license text.',
        '',
        ...sections.flatMap(section => [rule, '', section, ''])
    ].join('\n');
}

/**
 * The texts that go with a package. The visualizer's packages are covered by
 * the license at the root of their repository, which is where they are read
 * from: the submodule, not node_modules.
 */
function licenseTexts(root: string): string[] {
    for (let directory = root; directory !== dirname(directory); directory = dirname(directory)) {
        const files = readdirSync(directory).filter(name => NOTICE_FILE.test(name)).sort();
        if (files.length > 0) {
            return files.map(name => readFileSync(join(directory, name), 'utf8').trim());
        }
        if (directory === root && root.includes(`${sep}node_modules${sep}`)) {
            return [];
        }
        try {
            readFileSync(join(directory, '.git'));
            return [];
        } catch {
            // Not a repository root yet; keep walking up.
        }
    }
    return [];
}

/**
 * The npm package a bundled module belongs to, or nothing for this
 * repository's own sources. Inside node_modules the nearest package.json is
 * not enough: some packages put a stub one in a subdirectory.
 */
function packageRoot(path: string): string | undefined {
    const marker = `${sep}node_modules${sep}`;
    const at = path.lastIndexOf(marker);
    if (at >= 0) {
        const rest = path.slice(at + marker.length).split(sep);
        const depth = rest[0]?.startsWith('@') ? 2 : 1;
        return realpathSync(path.slice(0, at + marker.length) + rest.slice(0, depth).join(sep));
    }
    if (!path.includes(`${sep}vendor${sep}`)) {
        return undefined;
    }
    for (let directory = dirname(path); directory !== dirname(directory); directory = dirname(directory)) {
        try {
            if (JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')).name) {
                return directory;
            }
        } catch {
            // No package.json here; keep walking up.
        }
    }
    return undefined;
}

function licenseOf(manifest: { license?: string | { type?: string }; licenses?: Array<{ type?: string } | string> }): string | undefined {
    if (typeof manifest.license === 'string') {
        return manifest.license;
    }
    if (manifest.license?.type) {
        return manifest.license.type;
    }
    if (Array.isArray(manifest.licenses) && manifest.licenses.length > 0) {
        return manifest.licenses.map(entry => typeof entry === 'string' ? entry : entry.type).join(' OR ');
    }
    return undefined;
}

function offers(expression: string, license: string): boolean {
    return expression.replace(/[()]/g, '').split(/\s+OR\s+/).includes(license);
}

/** Some choice among an SPDX expression's ORs leaves only permissive licenses. */
function satisfies(expression: string): boolean {
    const tokens = expression.match(/\(|\)|[^\s()]+/g) ?? [];
    let next = 0;
    const or = (): boolean => {
        let value = and();
        while (tokens[next] === 'OR') {
            next++;
            value = and() || value;
        }
        return value;
    };
    const and = (): boolean => {
        let value = term();
        while (tokens[next] === 'AND') {
            next++;
            value = term() && value;
        }
        return value;
    };
    const term = (): boolean => {
        const token = tokens[next++];
        if (token === '(') {
            const value = or();
            next++;
            return value;
        }
        if (tokens[next] === 'WITH') {
            next += 2;
            return false;
        }
        return PERMISSIVE.has(token ?? '');
    };
    return or();
}
