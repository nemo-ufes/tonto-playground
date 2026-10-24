import './style.css';
import { readViewFile } from 'tonto-view';
import type { ViewFile } from 'tonto-view';
import { DEFAULT_MODEL } from './default-model.js';
import { createPanelFrame } from './diagram/frame.js';
import type { ExportFormat } from './diagram/host.js';
import { DiagramHost } from './diagram/host.js';
import { layoutInWorker } from './diagram/layout.js';
import { ViewStore } from './diagram/store.js';
import { createEditor } from './editor/editor.js';
import { exampleText } from './examples.js';
import { startLanguageWorker } from './language/client.js';
import type { Example } from './language/protocol.js';
import { linkTo, sharedIn } from './share.js';
import { load, save } from './storage.js';

let dark = (load('theme') ?? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')) === 'dark';
document.documentElement.dataset.theme = dark ? 'dark' : 'light';
element('theme').textContent = dark ? 'Light' : 'Dark';

// A shared link wins over what this browser remembers, once: it is taken out
// of the address so that a reload goes on with the modeller's own edits.
const shared = sharedIn(location.hash);
if (shared) {
    history.replaceState(null, '', location.pathname + location.search);
}

const language = startLanguageWorker();
const store = ViewStore.restore();
const editor = createEditor(element('editor'), {
    text: shared?.text ?? load('text') ?? DEFAULT_MODEL,
    dark,
    lsp: language.lsp
});
const host = new DiagramHost({
    frame: createPanelFrame(element('diagram')),
    store,
    layout: layoutInWorker(),
    setContent: content => language.setContent(content),
    reveal: (line, character) => {
        showPane('text');
        editor.reveal(line, character);
    },
    isDark: () => dark,
    notify,
    chooseExport,
    download: (extension, data) => download(`${modelName()}.${extension}`, data)
});
if (shared) {
    host.reset(editor.model.getVersionId(), arrangementIn(shared.view));
}
language.onView(update => host.update(update));
editor.onCursorLine(line => host.selectAtLine(line));

let saving: ReturnType<typeof setTimeout> | undefined;
editor.model.onDidChangeContent(() => {
    clearTimeout(saving);
    saving = setTimeout(() => save('text', editor.model.getValue()), 400);
});

language.onProblems((errors, warnings) => {
    const problems = element('problems');
    problems.replaceChildren();
    if (errors === 0 && warnings === 0) {
        problems.textContent = 'No problems';
        return;
    }
    const part = (count: number, noun: string, className: string) => {
        const span = document.createElement('span');
        span.className = className;
        span.textContent = `${count} ${noun}${count === 1 ? '' : 's'}`;
        return span;
    };
    if (errors > 0) {
        problems.append(part(errors, 'error', 'errors'));
    }
    if (errors > 0 && warnings > 0) {
        problems.append(' · ');
    }
    if (warnings > 0) {
        problems.append(part(warnings, 'warning', 'warnings'));
    }
});

/** Replaces the model, keeping Undo able to bring the previous text back. */
function replaceModel(text: string, arrangement?: ViewFile): void {
    const version = editor.replaceText(text);
    host.reset(version, arrangement);
    showPane('text');
}

language.onExamples(examples => {
    const select = element('examples') as HTMLSelectElement;
    const groups = new Map<string, HTMLOptGroupElement>();
    const byName = new Map<string, Example>();
    for (const example of examples) {
        let group = groups.get(example.group);
        if (!group) {
            group = document.createElement('optgroup');
            group.label = example.group;
            groups.set(example.group, group);
            select.append(group);
        }
        const option = document.createElement('option');
        option.value = example.name;
        option.textContent = example.title;
        option.title = example.intent;
        group.append(option);
        byName.set(example.name, example);
    }
    select.addEventListener('change', () => {
        const example = byName.get(select.value);
        select.value = '';
        if (example) {
            replaceModel(exampleText(example));
            notify(`${example.title} -- Undo in the editor brings back what was there`);
        }
    });
});

element('open').addEventListener('click', () => element('openFile').click());
element('openFile').addEventListener('change', async event => {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) {
        replaceModel(await file.text());
        notify(`Opened ${file.name}`);
    }
});

element('download').addEventListener('click', () => {
    download(`${modelName()}.tonto`, new Blob([editor.model.getValue()], { type: 'text/plain' }));
});

element('share').addEventListener('click', async () => {
    const view = Object.keys(store.state.nodes).length > 0 ? JSON.stringify(store.state) : undefined;
    const link = linkTo({ text: editor.model.getValue(), ...(view ? { view } : {}) });
    try {
        await navigator.clipboard.writeText(link);
        notify('Link copied. It holds the model; nothing is uploaded.');
    } catch {
        // No clipboard permission: the address bar is the next best place.
        history.replaceState(null, '', link);
        notify('The link is in the address bar. It holds the model; nothing is uploaded.');
    }
});

element('theme').addEventListener('click', () => {
    dark = !dark;
    save('theme', dark ? 'dark' : 'light');
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    element('theme').textContent = dark ? 'Light' : 'Dark';
    editor.setDark(dark);
    host.setDark(dark);
});

/** On a narrow screen one pane shows at a time. */
function showPane(pane: 'text' | 'diagram'): void {
    element('split').dataset.show = pane;
    element('showText').setAttribute('aria-pressed', String(pane === 'text'));
    element('showDiagram').setAttribute('aria-pressed', String(pane === 'diagram'));
}
element('showText').addEventListener('click', () => showPane('text'));
element('showDiagram').addEventListener('click', () => showPane('diagram'));

setUpDivider();

function setUpDivider(): void {
    const split = element('split');
    const divider = element('divider');
    const apply = (percent: number) => {
        const clamped = Math.min(80, Math.max(20, percent));
        split.style.setProperty('--editor-width', `${clamped}%`);
        divider.setAttribute('aria-valuenow', String(Math.round(clamped)));
        return clamped;
    };
    let width = apply(Number(load('editorWidth') ?? 45));
    divider.setAttribute('aria-valuemin', '20');
    divider.setAttribute('aria-valuemax', '80');
    divider.addEventListener('pointerdown', start => {
        divider.setPointerCapture(start.pointerId);
        divider.classList.add('dragging');
        // The iframe would swallow the pointer as it crosses into the diagram.
        element('diagram').style.pointerEvents = 'none';
        const bounds = split.getBoundingClientRect();
        const move = (event: PointerEvent) => {
            width = apply(((event.clientX - bounds.left) / bounds.width) * 100);
        };
        const end = () => {
            divider.classList.remove('dragging');
            element('diagram').style.pointerEvents = '';
            divider.removeEventListener('pointermove', move);
            save('editorWidth', String(Math.round(width)));
        };
        divider.addEventListener('pointermove', move);
        divider.addEventListener('pointerup', end, { once: true });
        divider.addEventListener('pointercancel', end, { once: true });
    });
    divider.addEventListener('keydown', event => {
        const step = event.key === 'ArrowLeft' ? -5 : event.key === 'ArrowRight' ? 5 : 0;
        if (step !== 0) {
            event.preventDefault();
            width = apply(width + step);
            save('editorWidth', String(Math.round(width)));
        }
    });
}

function arrangementIn(view: string | undefined): ViewFile | undefined {
    if (!view) {
        return undefined;
    }
    try {
        return readViewFile(JSON.parse(view));
    } catch {
        return undefined;
    }
}

/** The ontology's name, which is what the extension names its files after. */
function modelName(): string {
    return /^\s*ontology\s+([A-Za-z_][\w]*)/m.exec(editor.model.getValue())?.[1] ?? 'model';
}

function chooseExport(): Promise<ExportFormat | undefined> {
    const dialog = element('exportDialog') as HTMLDialogElement;
    return new Promise(resolve => {
        dialog.addEventListener('close', () => {
            const value = dialog.returnValue;
            resolve(value === 'svg' || value === 'png' || value === 'tontoview' ? value : undefined);
        }, { once: true });
        dialog.returnValue = '';
        dialog.showModal();
    });
}

function download(name: string, data: Blob): void {
    const url = URL.createObjectURL(data);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
function notify(message: string): void {
    const toast = element('toast');
    toast.textContent = message;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
        toast.hidden = true;
    }, 3500);
}

function element(id: string): HTMLElement {
    const found = document.getElementById(id);
    if (!found) {
        throw new Error(`the page has no #${id}`);
    }
    return found;
}
