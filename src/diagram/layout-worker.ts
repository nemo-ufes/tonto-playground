/**
 * ELK, off the page's thread: arranging a large model takes long enough to
 * stall typing, and the editor is on the page's thread.
 */

// First, so that ELK sees it when it loads.
import './elk-in-a-worker.js';
import { autoLayout } from 'tonto-canvas';
import type { LayoutRequest, LayoutResponse } from './layout.js';

addEventListener('message', async (event: MessageEvent<LayoutRequest>) => {
    const { id, view, sizes, current, request } = event.data;
    let response: LayoutResponse;
    try {
        response = { id, result: await autoLayout(view, sizes, current, request) };
    } catch (error) {
        response = { id, error: error instanceof Error ? error.message : String(error) };
    }
    postMessage(response);
});
