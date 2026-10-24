/**
 * `autoLayout`, answered by the layout worker: the same call and the same
 * result as `tonto-canvas`'s, with ELK running elsewhere.
 */

import type { AutoLayoutRequest, AutoLayoutResult } from 'tonto-canvas';
import type { Positions, Size } from 'tonto-canvas/draw';
import type { ViewModel } from 'tonto-view';

export interface LayoutRequest {
    id: number;
    view: ViewModel;
    sizes: Record<string, Size>;
    current: Positions;
    request: AutoLayoutRequest;
}

export type LayoutResponse =
    | { id: number; result: AutoLayoutResult; error?: undefined }
    | { id: number; error: string; result?: undefined };

export type AutoLayout = (
    view: ViewModel, sizes: Record<string, Size>, current: Positions, request?: AutoLayoutRequest
) => Promise<AutoLayoutResult>;

export function layoutInWorker(): AutoLayout {
    const worker = new Worker(new URL('./layout-worker.ts', import.meta.url), { type: 'module', name: 'tonto-layout' });
    const waiting = new Map<number, { resolve: (result: AutoLayoutResult) => void; reject: (error: Error) => void }>();
    let next = 0;
    // A worker that fails to load answers nothing; say so to everyone waiting
    // rather than leave the diagram unarranged without a word.
    worker.onerror = event => {
        for (const pending of waiting.values()) {
            pending.reject(new Error(event.message || 'the layout worker failed'));
        }
        waiting.clear();
    };
    worker.onmessage = (event: MessageEvent<LayoutResponse>) => {
        const pending = waiting.get(event.data.id);
        if (!pending) {
            return;
        }
        waiting.delete(event.data.id);
        if (event.data.error !== undefined) {
            pending.reject(new Error(event.data.error));
        } else {
            pending.resolve(event.data.result);
        }
    };
    return (view, sizes, current, request = {}) => new Promise((resolve, reject) => {
        const id = ++next;
        waiting.set(id, { resolve, reject });
        const message: LayoutRequest = { id, view, sizes, current, request };
        worker.postMessage(message);
    });
}
