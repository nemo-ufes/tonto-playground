/**
 * The diagram panel's host, for one document in a page: what the visualizer's
 * `DiagramPanel` (packages/extension/src/diagram-panel.ts) does for an editor
 * in VS Code, without files, named views or workspaces.
 *
 * The rules are the extension's, and so is most of the code that applies
 * them, through the helpers it exports: the arrangement belongs to the
 * modeller, a class added by an edit is placed without moving anything
 * placed, a parse error keeps the last picture, one action is one undo step.
 * Where this file follows `DiagramPanel` line for line it does so on purpose;
 * a fix there is a fix to make here.
 */

import type { Rect as CanvasRect } from 'tonto-canvas/draw';
import { darkTheme, drawnSizes, lightTheme, movedTo, placeNewNodes, render, sizeOf } from 'tonto-canvas/draw';
import type { ContentOptions, DisplayOptions, ViewModel, ViewRelation } from 'tonto-view';
import {
    contentAfter, expandInverseIds, filterDerivedMaterial, idsAtSource, nodesInSelection, packagesInScope, reconcile
} from 'tonto-view';
import { filterItemsOf, filterView } from 'tonto-visualizer/panel/filters';
import type { FilterItem, FromPanel, Rect, ToPanel } from 'tonto-visualizer/panel/protocol';
import { routesAffectedBy, safeRestoredPlacements } from 'tonto-visualizer/panel/restoration';
import type { ViewUpdate } from '../language/protocol.js';
import { DOCUMENT_URI } from '../language/protocol.js';
import type { PanelFrame } from './frame.js';
import type { AutoLayout } from './layout.js';
import { prioritizeRelatorPaths } from './relator-paths.js';
import type { ViewStore } from './store.js';

export type ExportFormat = 'svg' | 'png' | 'tontoview';

/** What the host needs from the page around it. */
export interface HostEnvironment {
    frame: PanelFrame;
    store: ViewStore;
    layout: AutoLayout;
    /** Asks the language worker to derive the diagram again with these options. */
    setContent(content: ContentOptions): void;
    /** Puts the editor's cursor on a 0-based line and character. */
    reveal(line: number, character: number): void;
    isDark(): boolean;
    /** A short message the modeller should see, such as what was undone. */
    notify(message: string): void;
    chooseExport(): Promise<ExportFormat | undefined>;
    /** Saves a file the page made, named after the model. */
    download(extension: string, data: Blob): void;
}

const EMPTY: ViewModel = { groups: [], nodes: [], edges: [], gensets: [] };

export class DiagramHost {
    private view: ViewModel = EMPTY;
    /** The last successfully derived model, before modeller-owned filters. */
    private catalog: ViewModel = EMPTY;
    /** The complete model, retained so Arrange can use hidden derived relations. */
    private completeCatalog: ViewModel = EMPTY;
    private positions: Record<string, Rect> = {};
    private packages: string[] = [];
    private filters: FilterItem[] = [];
    private visibleNodeIds = new Set<string>();
    private hasPresentedView = false;
    /** The first drawing of a model should fill the viewport, exactly once. */
    private fitNextView = true;
    private selected = new Set<string>();
    private ready = false;
    /** The last message built, so a panel that becomes ready late still gets it. */
    private last: ToPanel | undefined;
    /** Only the newest arrangement request may replace positions or routes. */
    private layoutRequest = 0;
    private updates: Promise<void> = Promise.resolve();
    /**
     * Updates for text older than this are about a model no longer in the
     * editor: the worker may still be answering for it after a replacement.
     */
    private minimumVersion = 0;
    private rasterRequest = 0;
    private readonly rasters = new Map<number, {
        resolve: (bytes: Uint8Array) => void;
        reject: (error: Error) => void;
        timer: ReturnType<typeof setTimeout>;
    }>();

    constructor(private readonly env: HostEnvironment) {
        env.frame.onMessage(message => void this.receive(message));
        env.setContent(env.store.state.content);
    }

    /** A new reading of the document from the language worker. */
    update(update: ViewUpdate): void {
        if (update.version < this.minimumVersion) {
            return;
        }
        this.layoutRequest += 1;
        this.updates = this.updates
            .then(() => this.apply(update))
            .catch(error => console.error('tonto-playground: could not draw the model', error));
    }

    /**
     * A different model replaced the text, as edit `version` of the document:
     * its arrangement, or none, replaces this one, and the next drawing starts
     * from nothing.
     */
    reset(version: number, arrangement?: Parameters<ViewStore['replace']>[0]): void {
        this.minimumVersion = version;
        this.env.store.replace(arrangement);
        this.layoutRequest += 1;
        this.view = EMPTY;
        this.catalog = EMPTY;
        this.completeCatalog = EMPTY;
        this.positions = {};
        this.filters = [];
        this.visibleNodeIds = new Set();
        this.selected = new Set();
        this.hasPresentedView = false;
        this.fitNextView = true;
        this.env.setContent(this.env.store.state.content);
    }

    setDark(dark: boolean): void {
        this.post({ type: 'theme', dark });
    }

    /**
     * The cursor sitting in a declaration selects it in the diagram: the
     * reader never has to hunt for the box that goes with the line they are on.
     */
    selectAtLine(line: number): void {
        const ids = idsAtSource(this.view, DOCUMENT_URI, line);
        this.selected = new Set(ids);
        this.post({ type: 'select', ids });
    }

    /**
     * A model that does not parse leaves the previous picture on screen with a
     * note saying so: someone typing a class name spends most of their
     * keystrokes in that state.
     */
    private async apply(update: ViewUpdate): Promise<void> {
        const store = this.env.store;
        if (update.parseError && this.catalog.nodes.length > 0) {
            this.installView(filterView(this.catalog, store.state.content.hidden ?? []));
            this.send(update.parseError);
            return;
        }
        this.packages = update.packages;
        this.completeCatalog = update.catalog;
        this.catalog = filterDerivedMaterial(update.catalog, store.state.content.derivedMaterialMode);
        this.filters = filterItemsOf(this.catalog);
        const isFirstDraw = this.installView(filterView(this.catalog, store.state.content.hidden ?? []));
        if (isFirstDraw) {
            // Nothing has been arranged yet, so this is the one time the
            // diagram may lay itself out completely.
            await this.autoLayoutNow();
            return;
        }
        this.send(update.parseError);
    }

    /** Reconciles a visible model with its saved arrangement (DiagramPanel.installView). */
    private installView(next: ViewModel): boolean {
        const store = this.env.store;
        const previous = this.positions;
        const returning = new Set(this.hasPresentedView
            ? next.nodes.filter(node => !this.visibleNodeIds.has(node.id)).map(node => node.id)
            : []);
        this.view = next;
        const reconciled = reconcile(store.state, next);
        const sizes = this.sizes(store.state.display);
        // A class newly introduced by an edit has a position on screen before
        // it has one in the store. Keep that local arrangement through the next
        // update; stored positions still win, which undo and redo require.
        const current = this.hasPresentedView
            ? Object.fromEntries(next.nodes
                .filter(node => this.visibleNodeIds.has(node.id) && previous[node.id])
                .map(node => [node.id, previous[node.id]!]))
            : {};
        const { placed: safePlaced, repositioned } = safeRestoredPlacements(
            next.nodes.map(node => node.id), returning, sizes, { ...current, ...reconciled.placed });

        const placed = placeNewNodes(next, sizes, safePlaced);
        const changed = new Set(returning);
        for (const node of next.nodes) {
            const before = previous[node.id];
            const after = placed[node.id];
            if (before && after && (before.width !== after.width || before.height !== after.height)) {
                changed.add(node.id);
            }
        }
        this.positions = placed;
        for (const id of repositioned) {
            const position = placed[id];
            const saved = store.state.nodes[id];
            if (position && saved) {
                store.move({ [id]: { ...saved, x: position.x, y: position.y } });
            }
        }
        this.dropRoutesAffectedBy(changed);
        this.visibleNodeIds = new Set(next.nodes.map(node => node.id));
        this.hasPresentedView = true;
        return Object.keys(reconciled.placed).length === 0 && next.nodes.length > 0;
    }

    private sizes(display: DisplayOptions): Record<string, { width: number; height: number }> {
        return Object.fromEntries(this.view.nodes.map(node => [node.id, sizeOf(node, display)]));
    }

    /** One document is both the file and the workspace. */
    private effectiveContent(content: ContentOptions): ContentOptions {
        return {
            ...content,
            includedPackages: packagesInScope(content, { file: this.packages, workspace: this.packages })
        };
    }

    /**
     * Drops every route whose endpoint moved, plus routes now crossed by one of
     * the changed boxes: a stored route depends on its whole corridor.
     */
    private dropRoutesAffectedBy(nodes: ReadonlySet<string>, preserve: ReadonlySet<string> = new Set()): void {
        const store = this.env.store;
        for (const edge of routesAffectedBy(this.catalog, this.positions, store.state.edges, nodes, preserve)) {
            store.reroute(edge, undefined);
        }
    }

    /** Arranges the diagram, and leaves the previous picture intact if ELK cannot. */
    private async autoLayoutNow(only?: string[]): Promise<'arranged' | 'failed' | 'superseded'> {
        const store = this.env.store;
        const request = ++this.layoutRequest;
        const view = this.view;
        const previous = this.positions;
        const arrangeDerivedRelators = store.state.content.derivedMaterialMode !== 'relations'
            && view.kind !== 'packages';
        const hidden = store.state.content.hidden ?? [];
        const layoutView = arrangeDerivedRelators
            ? prioritizeRelatorPaths(
                filterView(filterDerivedMaterial(this.completeCatalog, 'relators'), hidden),
                this.completeCatalog.edges.filter((edge): edge is ViewRelation =>
                    edge.kind === 'relation' && edge.stereotype === 'material'
                    && !hidden.includes(edge.id))
            )
            : view;
        const layoutNodeIds = new Set(layoutView.nodes.map(node => node.id));
        const layoutOnly = only?.filter(id => layoutView.nodes.some(node => node.id === id));
        // The size each card is drawn at, not the size its content needs: a card
        // the modeller widened is arranged around at the width they gave it.
        const sizes = drawnSizes(layoutView, this.sizes(store.state.display), store.state.nodes);
        const layoutCurrent = arrangeDerivedRelators
            ? Object.fromEntries(Object.entries(this.positions).filter(([id]) => layoutNodeIds.has(id)))
            : this.positions;
        let laid;
        try {
            laid = await this.env.layout(layoutView, sizes, layoutCurrent, {
                ...store.state.layout,
                ...(arrangeDerivedRelators ? {
                    associationDistance: Math.min(180, Math.round(store.state.layout.associationDistance * 1.5))
                } : {}),
                routing: store.state.display.routing,
                taxonomyOnly: store.state.display.taxonomyOnly,
                partonomyOnly: store.state.display.partonomyOnly,
                packageContainers: store.state.display.showPackageGroups,
                ...(only ? { only: layoutOnly } : {})
            });
        } catch (error) {
            if (request !== this.layoutRequest || view !== this.view) {
                return 'superseded';
            }
            const message = error instanceof Error ? error.message : String(error);
            this.env.notify(`Could not arrange this model: ${message}`);
            this.send();
            return 'failed';
        }
        if (request !== this.layoutRequest || view !== this.view) {
            return 'superseded';
        }
        this.positions = laid.positions as Record<string, CanvasRect>;
        store.move(movedTo(laid.positions, store.state.nodes));
        // Only an orthogonal drawing has routes to keep; a straight one is
        // recomputed from the boxes.
        const subject = only ? new Set(only) : undefined;
        const replaced = new Set<string>();
        for (const edge of view.edges) {
            if (!subject || subject.has(edge.source) || subject.has(edge.target)) {
                const points = laid.routes[edge.id];
                const route = arrangeDerivedRelators
                    || (subject && (!subject.has(edge.source) || !subject.has(edge.target)))
                    ? undefined
                    : points ? { points } : undefined;
                store.reroute(edge.id, route);
                if (route) {
                    replaced.add(edge.id);
                }
            }
        }
        if (subject) {
            const moved = new Set([...subject].filter(id => {
                const before = previous[id];
                const after = laid.positions[id];
                return before !== undefined && after !== undefined
                    && (before.x !== after.x || before.y !== after.y
                        || before.width !== after.width || before.height !== after.height);
            }));
            this.dropRoutesAffectedBy(moved, replaced);
        }
        this.send();
        return 'arranged';
    }

    private send(stale?: string): void {
        const store = this.env.store;
        const message: ToPanel = {
            type: 'model',
            view: this.view,
            positions: this.positions,
            routes: store.state.edges,
            display: store.state.display,
            content: this.effectiveContent(store.state.content),
            layout: store.state.layout,
            packages: this.packages,
            hasMultipleViews: false,
            filters: this.filters,
            ...(this.fitNextView ? { fit: true } : {}),
            ...(stale ? { stale } : {})
        };
        this.last = message;
        this.post(message);
        if (this.ready) {
            this.fitNextView = false;
        }
    }

    private post(message: ToPanel): void {
        if (this.ready) {
            this.env.frame.post(message);
        }
    }

    private async receive(message: FromPanel): Promise<void> {
        const store = this.env.store;
        switch (message.type) {
            case 'ready':
                this.ready = true;
                this.post({ type: 'theme', dark: this.env.isDark() });
                if (this.last) {
                    this.env.frame.post(this.last);
                    this.fitNextView = false;
                }
                return;
            case 'moved': {
                store.begin(message.resized ? 'Resize' : 'Move');
                this.layoutRequest += 1;
                store.move(message.positions);
                // The size a card is drawn at is what it holds, grown to
                // whatever the arrangement asks for.
                const drawn = drawnSizes(this.view, this.sizes(store.state.display), store.state.nodes);
                for (const [id, placement] of Object.entries(message.positions)) {
                    this.positions[id] = {
                        x: placement.x,
                        y: placement.y,
                        ...(drawn[id] ?? { width: 160, height: 60 })
                    };
                }
                this.dropRoutesAffectedBy(new Set(Object.keys(message.positions)));
                return;
            }
            case 'rerouted':
                store.begin(message.route ? 'Route' : 'Straighten');
                this.layoutRequest += 1;
                store.reroute(message.edge, message.route);
                return;
            case 'reveal':
                this.reveal(message.id);
                return;
            case 'display': {
                store.begin('Display option');
                const before = store.state.display.routing;
                store.update({ display: { ...store.state.display, ...message.display } });
                if (message.display.routing && message.display.routing !== before) {
                    // The routes belong to the style that made them.
                    for (const edge of Object.keys(store.state.edges)) {
                        store.reroute(edge, undefined);
                    }
                    this.layoutRequest += 1;
                    this.send();
                    return;
                }
                const previous = this.positions;
                this.positions = placeNewNodes(this.view, this.sizes(store.state.display), previous);
                const resized = new Set(this.view.nodes
                    .filter(node => previous[node.id]?.width !== this.positions[node.id]?.width
                        || previous[node.id]?.height !== this.positions[node.id]?.height)
                    .map(node => node.id));
                this.layoutRequest += 1;
                this.dropRoutesAffectedBy(resized);
                this.send();
                return;
            }
            case 'layout':
                store.begin('Layout option');
                store.update({ layout: { ...store.state.layout, ...message.layout } });
                if (await this.autoLayoutNow() === 'failed') {
                    store.undo();
                    this.send();
                }
                return;
            case 'content':
                store.begin('Content option');
                store.update({ content: contentAfter(store.state.content, message.content) });
                this.env.setContent(store.state.content);
                return;
            case 'hide': {
                store.begin('Hide');
                const hidden = new Set([
                    ...(store.state.content.hidden ?? []),
                    ...expandInverseIds(this.view.edges, message.ids)
                ]);
                store.update({ content: { ...store.state.content, hidden: [...hidden] } });
                this.env.setContent(store.state.content);
                return;
            }
            case 'show': {
                store.begin('Show');
                const shown = new Set(message.ids);
                const hidden = (store.state.content.hidden ?? []).filter(id => !shown.has(id));
                store.update({ content: { ...store.state.content, hidden } });
                this.env.setContent(store.state.content);
                return;
            }
            case 'autoLayout':
                store.begin(message.only ? 'Arrange selection' : 'Arrange');
                await this.autoLayoutNow(message.only);
                return;
            case 'undo':
                this.stepBack(true);
                return;
            case 'redo':
                this.stepBack(false);
                return;
            case 'export':
                await this.exportDiagram(message.format);
                return;
            case 'raster': {
                const waiting = this.rasters.get(message.id);
                if (waiting) {
                    this.rasters.delete(message.id);
                    clearTimeout(waiting.timer);
                    if (message.data) {
                        waiting.resolve(Uint8Array.from(atob(message.data), character => character.charCodeAt(0)));
                    } else {
                        waiting.reject(new Error(message.error ?? 'the panel could not draw it'));
                    }
                }
                return;
            }
            case 'selected':
                this.selected = new Set(message.ids);
                return;
            case 'chooseView':
            case 'switchOntologyDiagram':
            case 'moveToNewWindow':
                // A VS Code window's: one document has one view, and no window to move.
                return;
        }
    }

    /** Arrange the selection, or everything when nothing is selected. */
    async arrange(): Promise<void> {
        const only = nodesInSelection(this.view, this.selected).filter(id => this.positions[id] !== undefined);
        this.env.store.begin(only.length > 0 ? 'Arrange selection' : 'Arrange');
        await this.autoLayoutNow(only.length > 0 ? only : undefined);
    }

    /** Takes a view change back, or puts it back; the text has its own undo. */
    private stepBack(backwards: boolean): void {
        const store = this.env.store;
        const content = store.state.content;
        const label = backwards ? store.undo() : store.redo();
        if (!label) {
            this.env.notify(`Nothing to ${backwards ? 'undo' : 'redo'} in the diagram`);
            return;
        }
        this.layoutRequest += 1;
        this.env.notify(`${backwards ? 'Undo' : 'Redo'}: ${label}`);
        if (store.state.content !== content) {
            // What is drawn changed, not only where: derive it again.
            this.env.setContent(store.state.content);
            return;
        }
        const reconciled = reconcile(store.state, this.view);
        this.positions = placeNewNodes(this.view, this.sizes(store.state.display), reconciled.placed);
        this.send();
    }

    /** Puts the editor's cursor on the declaration an element was written in. */
    private reveal(id: string): void {
        const node = this.view.nodes.find(candidate => candidate.id === id);
        const edge = this.view.edges.find(candidate => candidate.id === id);
        const genset = this.view.gensets.find(candidate => candidate.id === id);
        const location = node?.source
            ?? (edge && 'source_' in edge ? edge.source_ : undefined)
            ?? genset?.source;
        if (location) {
            this.env.reveal(location.line, location.character);
        }
    }

    /** Writes the diagram out, as the drawing, a picture of it, or its arrangement. */
    private async exportDiagram(format?: 'svg' | 'png'): Promise<void> {
        const chosen = format ?? await this.env.chooseExport();
        if (!chosen) {
            return;
        }
        if (chosen === 'tontoview') {
            this.env.download('tontoview', new Blob([this.env.store.serialize()], { type: 'application/json' }));
            return;
        }
        const store = this.env.store;
        const drawn = render({
            view: this.view,
            positions: this.positions,
            routes: store.state.edges,
            display: store.state.display,
            direction: store.state.layout.direction,
            theme: this.env.isDark() ? darkTheme : lightTheme
        });
        try {
            const data = chosen === 'png'
                ? new Blob([await this.rasterise(drawn.svg) as BlobPart], { type: 'image/png' })
                : new Blob([drawn.svg], { type: 'image/svg+xml' });
            this.env.download(chosen, data);
        } catch (error) {
            this.env.notify(`Could not export the diagram: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * Asks the panel to draw the SVG as pixels, at twice the size: a diagram
     * exported to be looked at is read on a denser screen than it was drawn on.
     */
    private rasterise(svg: string): Promise<Uint8Array> {
        const id = ++this.rasterRequest;
        return new Promise<Uint8Array>((resolve, reject) => {
            const timer = setTimeout(() => {
                this.rasters.delete(id);
                reject(new Error('the diagram did not answer in time'));
            }, 20000);
            this.rasters.set(id, { resolve, reject, timer });
            this.post({ type: 'rasterise', id, svg, scale: 2 });
        });
    }
}
