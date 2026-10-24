/**
 * tonto's modeling patterns as starting models: each one the catalog's model,
 * under an ontology header, with what it is for and what to watch for as
 * comments above it.
 */

import type { Example } from './language/protocol.js';

export function exampleText(example: Example): string {
    // Ontology names are lower case, a hyphen does not make a name, and
    // several patterns are named after the keyword they teach.
    const name = `${example.name.replace(/-/g, '_')}_example`;
    return [
        `/// ${sentence(example.title)}`,
        `/// ${example.intent}`,
        `ontology ${name}`,
        '',
        ...wrap(example.note, 76).map(line => `// ${line}`),
        '//',
        ...wrap(`Source: ${example.source}`, 76).map(line => `// ${line}`),
        '',
        example.model,
        ''
    ].join('\n');
}

function sentence(text: string): string {
    return /[.!?]$/.test(text) ? text : `${text}.`;
}

function wrap(text: string, width: number): string[] {
    const lines: string[] = [];
    let line = '';
    for (const word of text.split(/\s+/).filter(Boolean)) {
        if (line && line.length + 1 + word.length > width) {
            lines.push(line);
            line = word;
        } else {
            line = line ? `${line} ${word}` : word;
        }
    }
    if (line) {
        lines.push(line);
    }
    return lines;
}
