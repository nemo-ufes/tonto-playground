/**
 * `node:async_hooks` for a page: the store holds for the duration of `run`,
 * and through the promise it returns.
 *
 * Node keeps the value per asynchronous context. Here it is one value, which
 * is the same thing while one build runs at a time -- and the language worker
 * builds one document, so one build is all there is. Two interleaved builds
 * would read each other's ontology; see the risks in docs/PLAN.md.
 */

export class AsyncLocalStorage<T> {
    private store: T | undefined;

    getStore(): T | undefined {
        return this.store;
    }

    run<R>(store: T, callback: (...args: unknown[]) => R, ...args: unknown[]): R {
        const previous = this.store;
        this.store = store;
        let result: R;
        try {
            result = callback(...args);
        } catch (error) {
            this.store = previous;
            throw error;
        }
        if (result instanceof Promise) {
            return result.finally(() => {
                this.store = previous;
            }) as R;
        }
        this.store = previous;
        return result;
    }
}
