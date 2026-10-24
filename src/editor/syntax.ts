/**
 * The tonto language as Monaco knows it before the server answers: keywords,
 * comments and strings, and the editing behaviour of brackets and quotes.
 *
 * Both come from the files the VS Code extension ships -- the TextMate
 * grammar Langium generates from the grammar, and the language configuration
 * -- so a keyword added to the language is highlighted here at the next pin
 * update without anyone listing it. Names are coloured by the server's
 * semantic tokens, which say what a name refers to rather than how it looks.
 */

import type * as monaco from 'monaco-editor';
import configuration from '../../vendor/tonto-visualizer/vendor/tonto/packages/extension/language-configuration.json';
import grammar from '../../vendor/tonto-visualizer/vendor/tonto/packages/extension/syntaxes/tonto.tmLanguage.json';

export const LANGUAGE_ID = 'tonto';

interface TextMatePattern {
    name?: string;
    match?: string;
}

/** The keyword alternation, exactly as the generated grammar writes it. */
function keywordPattern(): RegExp {
    const keyword = (grammar.patterns as TextMatePattern[])
        .find(pattern => pattern.name?.startsWith('keyword.') && pattern.match);
    if (!keyword?.match) {
        throw new Error('the tonto TextMate grammar has no keyword pattern');
    }
    return new RegExp(keyword.match);
}

export function monarch(): monaco.languages.IMonarchLanguage {
    return {
        defaultToken: '',
        tokenPostfix: '.tonto',
        tokenizer: {
            root: [
                [/\/\/\/.*$/, 'comment.doc'],
                [/\/\/.*$/, 'comment'],
                [/\/\*/, 'comment', '@comment'],
                [keywordPattern(), 'keyword'],
                [/"([^"\\]|\\.)*"/, 'string'],
                [/'([^'\\]|\\.)*'/, 'string'],
                [/<[^>\s]*>/, 'string.link'],
                [/@[A-Za-z]+/, 'annotation'],
                [/\d+|\*/, 'number'],
                [/[{}[\]()]/, '@brackets']
            ],
            comment: [
                [/[^/*]+/, 'comment'],
                [/\*\//, 'comment', '@pop'],
                [/[/*]/, 'comment']
            ]
        }
    };
}

export function languageConfiguration(): monaco.languages.LanguageConfiguration {
    // The same schema as VS Code's; JSON arrays only type as the pairs it means.
    return configuration as unknown as monaco.languages.LanguageConfiguration;
}
