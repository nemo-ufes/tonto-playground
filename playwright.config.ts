import { defineConfig } from '@playwright/test';

/**
 * The playground as it ships: built, served, and driven in Chromium. A test
 * in Node cannot see what only a browser does -- a missing `process`, a
 * worker that will not start, a panel that never draws.
 */
export default defineConfig({
    testDir: 'e2e',
    timeout: 60_000,
    fullyParallel: true,
    reporter: process.env.CI ? 'github' : 'list',
    use: {
        baseURL: 'http://localhost:4174/',
        viewport: { width: 1400, height: 820 }
    },
    // Chromium's own user agent, not a device preset's: Monaco picks Ctrl or
    // Cmd shortcuts from the platform it reports, and so does ControlOrMeta.
    projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
    webServer: {
        command: 'npx vite build && npx vite preview --port 4174 --strictPort',
        url: 'http://localhost:4174/',
        reuseExistingServer: !process.env.CI,
        timeout: 180_000
    }
});
