import './style.css';
import { DEFAULT_MODEL } from './default-model.js';
import { createEditor } from './editor/editor.js';
import { startLanguageWorker } from './language/client.js';
import { load, save } from './storage.js';

const dark = (load('theme') ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')) === 'dark';
document.documentElement.dataset.theme = dark ? 'dark' : 'light';

const language = startLanguageWorker();
const editor = createEditor(element('editor'), {
    text: load('text') ?? DEFAULT_MODEL,
    dark,
    lsp: language.lsp
});

let saving: ReturnType<typeof setTimeout> | undefined;
editor.model.onDidChangeContent(() => {
    clearTimeout(saving);
    saving = setTimeout(() => save('text', editor.model.getValue()), 400);
});

function element(id: string): HTMLElement {
    const found = document.getElementById(id);
    if (!found) {
        throw new Error(`the page has no #${id}`);
    }
    return found;
}
