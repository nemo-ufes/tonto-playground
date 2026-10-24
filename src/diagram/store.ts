/**
 * The arrangement of the diagram and its history: what the visualizer's
 * `ViewStore` keeps in `views/<model>.tontoview`, kept in `localStorage`.
 *
 * Same file format, so the arrangement can be downloaded as a `.tontoview`
 * and opened in VS Code beside the downloaded model. Same history rules: one
 * modeller action is one step however much it changes, a change the model
 * forced is not a step, and anything undone is on offer only until something
 * else is done.
 */

import type { EdgeRoute, Placement, ViewFile } from 'tonto-view';
import { emptyViewFile, readViewFile } from 'tonto-view';
import { load, save } from '../storage.js';

/** How far back a view can be taken. Each entry is a whole `ViewFile`. */
const HISTORY = 100;
const KEY = 'view';

interface Step {
    label: string;
    file: ViewFile;
}

export class ViewStore {
    private file: ViewFile;
    private readonly done: Step[] = [];
    private readonly undone: Step[] = [];
    private step: Step | undefined;
    private saving: ReturnType<typeof setTimeout> | undefined;

    private constructor(file: ViewFile) {
        this.file = file;
    }

    /** The arrangement saved by the last visit, or none. */
    static restore(): ViewStore {
        const saved = load(KEY);
        if (saved) {
            try {
                return new ViewStore(readViewFile(JSON.parse(saved)));
            } catch {
                // A file this version cannot read is an arrangement lost, not a page that fails.
            }
        }
        return new ViewStore(emptyViewFile());
    }

    get state(): ViewFile {
        return this.file;
    }

    /** As a `.tontoview` file, the way the extension writes one. */
    serialize(): string {
        return JSON.stringify(this.file, undefined, 2) + '\n';
    }

    /**
     * Starts over with another arrangement, or none: a different model is
     * being shown. Its history goes with it -- undoing into another model's
     * arrangement would move boxes that are not there.
     */
    replace(file: ViewFile = emptyViewFile()): void {
        this.file = file;
        this.done.length = 0;
        this.undone.length = 0;
        this.step = undefined;
        this.schedule();
    }

    /** Opens a step: everything changed until the next one is undone together. */
    begin(label: string): void {
        this.step = { label, file: this.file };
    }

    move(positions: Record<string, Placement>): void {
        this.record();
        this.file = { ...this.file, nodes: { ...this.file.nodes, ...positions } };
        this.schedule();
    }

    reroute(edge: string, route: EdgeRoute | undefined): void {
        this.record();
        if (route) {
            this.file = { ...this.file, edges: { ...this.file.edges, [edge]: route } };
        } else {
            const { [edge]: _dropped, ...rest } = this.file.edges;
            this.file = { ...this.file, edges: rest };
        }
        this.schedule();
    }

    update(patch: Partial<Pick<ViewFile, 'content' | 'display' | 'layout'>>): void {
        this.record();
        this.file = { ...this.file, ...patch };
        this.schedule();
    }

    /** Takes back the last step, and says what it was. */
    undo(): string | undefined {
        return this.swap(this.done, this.undone);
    }

    /** Puts back the last step taken back, and says what it was. */
    redo(): string | undefined {
        return this.swap(this.undone, this.done);
    }

    private swap(from: Step[], to: Step[]): string | undefined {
        const step = from.pop();
        if (!step) {
            return undefined;
        }
        to.push({ label: step.label, file: this.file });
        this.file = step.file;
        this.step = undefined;
        this.schedule();
        return step.label;
    }

    /** Closes the open step, if the change about to be made is the first in it. */
    private record(): void {
        if (!this.step) {
            return;
        }
        this.done.push(this.step);
        this.step = undefined;
        if (this.done.length > HISTORY) {
            this.done.shift();
        }
        this.undone.length = 0;
    }

    /** A drag is hundreds of pointer events; storage hears about it once. */
    private schedule(): void {
        clearTimeout(this.saving);
        this.saving = setTimeout(() => save(KEY, JSON.stringify(this.file)), 500);
    }
}
