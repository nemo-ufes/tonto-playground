import type { FrameLocator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

/** Errors the page throws or logs; every test ends by expecting none. */
function watchErrors(page: Page): string[] {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
        if (message.type() === 'error') {
            errors.push(message.text());
        }
    });
    return errors;
}

function diagram(page: Page): FrameLocator {
    return page.frameLocator('#diagram iframe');
}

async function nodes(page: Page): Promise<string[]> {
    return diagram(page).locator('g.tv-node').evaluateAll(groups => groups.map(group => group.getAttribute('data-node') ?? ''));
}

function box(page: Page, id: string) {
    return diagram(page).locator(`g.tv-node[data-node="${id}"] rect`).first();
}

/** The editor's line, 1-based, as a modeller counts. */
function line(page: Page, number: number) {
    return page.locator('.view-line').nth(number - 1);
}

test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await expect(box(page, 'people::Employment')).toBeVisible();
});

test('opens with the README model checked and drawn', async ({ page }) => {
    const errors = watchErrors(page);
    await page.reload();
    await expect(page.locator('#problems')).toHaveText('No problems');
    await expect.poll(() => nodes(page)).toEqual(expect.arrayContaining([
        'people::Person', 'people::Employee', 'people::Organization', 'people::Employer', 'people::Employment'
    ]));
    // The class's documentation is its tooltip in the diagram.
    await expect(diagram(page).locator('g.tv-node[data-node="people::Person"] title')).toHaveText('A person, in the everyday sense.');
    expect(errors).toEqual([]);
});

test('draws a class as it is typed, without moving what is placed', async ({ page }) => {
    const before = await box(page, 'people::Person').getAttribute('x');
    await line(page, 23).click();
    await page.keyboard.type('\nkind Building\n');
    await expect(box(page, 'people::Building')).toBeVisible();
    expect(await box(page, 'people::Person').getAttribute('x')).toBe(before);
});

test('keeps the last picture while the text does not parse, and says where', async ({ page }) => {
    await line(page, 23).click();
    await page.keyboard.type('kind {');
    const stale = diagram(page).locator('#stale');
    await expect(stale).toBeVisible();
    await expect(stale).toHaveAttribute('title', /^line \d+: /);
    await expect(box(page, 'people::Person')).toBeVisible();
    for (let index = 0; index < 'kind {'.length; index++) {
        await page.keyboard.press('Backspace');
    }
    await expect(stale).toBeHidden();
});

test('offers and applies the repair a rule forces', async ({ page }) => {
    await line(page, 18).click();
    await page.keyboard.press('End');
    for (let index = 0; index < 'Employee'.length; index++) {
        await page.keyboard.press('ArrowLeft');
    }
    for (let index = 0; index < '(const) '.length; index++) {
        await page.keyboard.press('Backspace');
    }
    await expect(page.locator('#problems')).toContainText('warning');
    await page.keyboard.press('ControlOrMeta+Period');
    await page.locator('.action-widget .monaco-list-row', { hasText: 'Mark the end "const"' }).click();
    await expect(line(page, 18)).toHaveText(/\[1\]\s\(const\)\sEmployee/);
    await expect(page.locator('#problems')).toHaveText('No problems');
});

test('joins the text and the diagram both ways', async ({ page }) => {
    await box(page, 'people::Organization').dblclick({ force: true });
    await expect(page.locator('.line-numbers.active-line-number')).toHaveText('11');
    await line(page, 5).click();
    await expect(diagram(page).locator('.tv-selected')).toHaveAttribute('data-node', 'people::Person');
});

test('shares the model and its arrangement in a link', async ({ page, browser }) => {
    const person = box(page, 'people::Person');
    const at = await person.boundingBox();
    await page.mouse.move(at!.x + 40, at!.y + 20);
    await page.mouse.down();
    await page.mouse.move(at!.x + 240, at!.y + 20, { steps: 6 });
    await page.mouse.up();
    const moved = await person.getAttribute('x');

    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.click('#share');
    const link = await page.evaluate(() => navigator.clipboard.readText());
    expect(link).toContain('#model=');

    const elsewhere = await (await browser.newContext()).newPage();
    await elsewhere.goto(link);
    await expect(box(elsewhere, 'people::Person')).toHaveAttribute('x', moved!);
    expect(elsewhere.url()).not.toContain('#');
});

test('replaces the text with an example, and Undo brings it back', async ({ page }) => {
    await page.selectOption('#examples', 'phase-partition');
    await expect(box(page, 'phase_partition_example::Child')).toBeVisible();
    await expect(page.locator('#problems')).toHaveText('No problems');
    await line(page, 1).click();
    await page.keyboard.press('ControlOrMeta+z');
    await expect(line(page, 1)).toHaveText('/// People and their employment.');
});

test('exports the drawing', async ({ page }) => {
    const download = page.waitForEvent('download');
    await diagram(page).locator('#exportButton').click();
    await page.click('#exportDialog button[value="svg"]');
    expect((await download).suggestedFilename()).toBe('people.svg');
});

test('shows one pane at a time on a phone', async ({ browser }) => {
    const phone = await (await browser.newContext({ viewport: { width: 390, height: 760 }, isMobile: true, hasTouch: true })).newPage();
    await phone.goto('/');
    await expect(phone.locator('#editor')).toBeVisible();
    await expect(phone.locator('#diagram')).toBeHidden();
    await phone.click('#showDiagram');
    await expect(box(phone, 'people::Employment')).toBeVisible();
    expect(await phone.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
