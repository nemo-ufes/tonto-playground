/**
 * The visualizer's diagram panel, in an iframe: the page a VS Code webview
 * would give it, with this page playing the extension host.
 *
 * The body, script, stylesheet and message types are the ones the extension
 * itself loads, taken from what its package exports, so there is no copy here
 * to drift. What VS Code supplies around a webview is supplied here instead:
 * `acquireVsCodeApi`, and the theme's colours as `--vscode-*` variables.
 */

import { PANEL_BODY } from 'tonto-visualizer/panel/skeleton';
import type { FromPanel, ToPanel } from 'tonto-visualizer/panel/protocol';
import scriptUrl from 'tonto-visualizer/panel/script?url';
import styleUrl from 'tonto-visualizer/panel/style?url';

export interface PanelFrame {
    post(message: ToPanel): void;
    onMessage(listener: (message: FromPanel) => void): void;
}

/**
 * The colours a VS Code theme would give the panel. Its stylesheet already
 * falls back to light ones where a variable is missing, so only what differs
 * from those is set for light; dark has to be said in full.
 */
const THEME = `
body {
    --vscode-focusBorder: #005fb8;
    --vscode-button-background: #005fb8;
    --vscode-button-foreground: #ffffff;
    --vscode-button-hoverBackground: #0258a8;
}
body.dark {
    --vscode-editor-background: #1e1e1e;
    --vscode-foreground: #cccccc;
    --vscode-descriptionForeground: #9d9d9d;
    --vscode-focusBorder: #3794ff;
    --vscode-panel-border: #3c3c3c;
    --vscode-editorWidget-background: #252526;
    --vscode-button-background: #0e639c;
    --vscode-button-foreground: #ffffff;
    --vscode-button-hoverBackground: #1177bb;
    --vscode-button-border: transparent;
    --vscode-button-secondaryBackground: #3a3d41;
    --vscode-button-secondaryForeground: #cccccc;
    --vscode-button-secondaryHoverBackground: #45494e;
    --vscode-dropdown-background: #3c3c3c;
    --vscode-dropdown-foreground: #cccccc;
    --vscode-dropdown-border: #3c3c3c;
    --vscode-scrollbarSlider-background: rgba(121, 121, 121, 0.4);
    --vscode-scrollbarSlider-hoverBackground: rgba(100, 100, 100, 0.7);
    --vscode-editorWarning-foreground: #cca700;
}
/* Moving the panel into a window of its own, and choosing among saved views,
   are things a VS Code window does. */
#newWindow, #views { display: none !important; }
/* A VS Code panel is never as narrow as a phone; the toolbar wraps there
   rather than hiding Export past the edge. */
@media (max-width: 600px) {
    #toolbar { flex-wrap: wrap; row-gap: 4px; }
}
`;

export function createPanelFrame(container: HTMLElement): PanelFrame {
    const frame = document.createElement('iframe');
    frame.title = 'OntoUML diagram';
    const listeners: Array<(message: FromPanel) => void> = [];

    // The panel's script calls this once, as it starts. Messages to the host
    // go to this page; what the panel keeps across reloads (zoom and scroll)
    // lives as long as the tab does, as a webview's state lives with its panel.
    const bridge = `
        <script>
            window.acquireVsCodeApi = () => ({
                postMessage: message => parent.postMessage({ tontoPanel: message }, '*'),
                getState: () => { try { return JSON.parse(sessionStorage.getItem('tonto-panel') ?? 'null') ?? undefined; } catch { return undefined; } },
                setState: state => { try { sessionStorage.setItem('tonto-panel', JSON.stringify(state)); } catch {} }
            });
        </script>`;
    frame.srcdoc = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<link rel="stylesheet" href="${new URL(styleUrl, location.href).href}">
<style>${THEME}</style>
${bridge}
</head>
<body>
${PANEL_BODY}
<script src="${new URL(scriptUrl, location.href).href}"></script>
</body>
</html>`;
    container.append(frame);

    addEventListener('message', (event: MessageEvent<{ tontoPanel?: FromPanel }>) => {
        if (event.source === frame.contentWindow && event.data?.tontoPanel) {
            for (const listener of listeners) {
                listener(event.data.tontoPanel);
            }
        }
    });

    return {
        post: message => frame.contentWindow?.postMessage(message, '*'),
        onMessage: listener => {
            listeners.push(listener);
        }
    };
}
