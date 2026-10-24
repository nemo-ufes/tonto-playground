/**
 * The editor: Monaco, with Monaco's own LSP client talking to the language
 * worker. Completion, hover, quick fixes, rename, formatting, folding and
 * semantic highlighting are the server's; nothing here re-implements one.
 */

import * as monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import { DOCUMENT_URI } from '../language/protocol.js';
import { LANGUAGE_ID, languageConfiguration, monarch } from './syntax.js';

globalThis.MonacoEnvironment = { getWorker: () => new EditorWorker() };

export interface EditorOptions {
    text: string;
    dark: boolean;
    /** The language worker's JSON-RPC port. */
    lsp: MessagePort;
}

export interface Editor {
    readonly monaco: monaco.editor.IStandaloneCodeEditor;
    readonly model: monaco.editor.ITextModel;
    setDark(dark: boolean): void;
    /** Puts the cursor at a 0-based line and character and brings it into view. */
    reveal(line: number, character: number): void;
}

export function createEditor(container: HTMLElement, options: EditorOptions): Editor {
    monaco.languages.register({ id: LANGUAGE_ID, extensions: ['.tonto'], aliases: ['tonto'] });
    monaco.languages.setMonarchTokensProvider(LANGUAGE_ID, monarch());
    monaco.languages.setLanguageConfiguration(LANGUAGE_ID, languageConfiguration());
    defineThemes();

    // The model exists before the client does, so the server is told about it
    // as soon as the connection opens rather than on the first keystroke.
    const model = monaco.editor.createModel(options.text, LANGUAGE_ID, monaco.Uri.parse(DOCUMENT_URI));
    const editor = monaco.editor.create(container, {
        model,
        theme: themeName(options.dark),
        automaticLayout: true,
        minimap: { enabled: false },
        'semanticHighlighting.enabled': true,
        fixedOverflowWidgets: true,
        scrollBeyondLastLine: false,
        fontSize: 13,
        tabSize: 4,
        insertSpaces: true,
        renderWhitespace: 'none',
        lightbulb: { enabled: monaco.editor.ShowLightbulbIconMode.OnCode },
        // The tab key moves focus out of the editor only when asked to, as in
        // VS Code; Ctrl+M toggles it, and the page says so in its help.
        tabFocusMode: false
    });

    new monaco.lsp.MonacoLspClient(monaco.lsp.createTransportToWorker(options.lsp as unknown as Worker));
    // The transport listens with addEventListener, which on a MessagePort
    // delivers nothing until the port is started.
    options.lsp.start();

    return {
        monaco: editor,
        model,
        setDark: dark => monaco.editor.setTheme(themeName(dark)),
        reveal: (line, character) => {
            const position = { lineNumber: line + 1, column: character + 1 };
            editor.setPosition(position);
            editor.revealPositionInCenterIfOutsideViewport(position);
            editor.focus();
        }
    };
}

function themeName(dark: boolean): string {
    return dark ? 'tonto-dark' : 'tonto-light';
}

/**
 * VS Code's Light+ and Dark+ colours for the token types the server sends, so
 * a model reads the same here as it does in the extension.
 */
function defineThemes(): void {
    const light: monaco.editor.ITokenThemeRule[] = [
        { token: 'keyword', foreground: 'AF00DB' },
        { token: 'comment', foreground: '008000' },
        { token: 'comment.doc', foreground: '3B7D3B', fontStyle: 'italic' },
        { token: 'string', foreground: 'A31515' },
        { token: 'string.link', foreground: '0451A5' },
        { token: 'number', foreground: '098658' },
        { token: 'annotation', foreground: '795E26' },
        { token: 'class', foreground: '267F99' },
        { token: 'type', foreground: '267F99' },
        { token: 'namespace', foreground: '267F99' },
        { token: 'enumMember', foreground: '0070C1' },
        { token: 'decorator', foreground: '795E26' },
        { token: 'property', foreground: '001080' },
        { token: 'method', foreground: '795E26' }
    ];
    const dark: monaco.editor.ITokenThemeRule[] = [
        { token: 'keyword', foreground: 'C586C0' },
        { token: 'comment', foreground: '6A9955' },
        { token: 'comment.doc', foreground: '6A9955', fontStyle: 'italic' },
        { token: 'string', foreground: 'CE9178' },
        { token: 'string.link', foreground: '9CDCFE' },
        { token: 'number', foreground: 'B5CEA8' },
        { token: 'annotation', foreground: 'DCDCAA' },
        { token: 'class', foreground: '4EC9B0' },
        { token: 'type', foreground: '4EC9B0' },
        { token: 'namespace', foreground: '4EC9B0' },
        { token: 'enumMember', foreground: '4FC1FF' },
        { token: 'decorator', foreground: 'DCDCAA' },
        { token: 'property', foreground: '9CDCFE' },
        { token: 'method', foreground: 'DCDCAA' }
    ];
    monaco.editor.defineTheme('tonto-light', { base: 'vs', inherit: true, rules: light, colors: {} });
    monaco.editor.defineTheme('tonto-dark', { base: 'vs-dark', inherit: true, rules: dark, colors: {} });
}
