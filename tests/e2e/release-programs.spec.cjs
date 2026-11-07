const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { launch, screenshotPath } = require('./helpers.cjs');
const { defaults } = require('../../app/core/config.cjs');
const { repository } = require('../helpers/repository.cjs');
const { ReleaseDownloads } = require('../../app/core/release-downloads.cjs');
const { readJson, writeJson } = require('../../app/core/store.cjs');
const cleanup = [];
test.afterEach(async () => {
  while (cleanup.length) await cleanup.pop()();
});
async function app(options = {}) {
  const result = await launch(options);
  cleanup.push(() => result.close());
  return result;
}
async function fixture() {
  const callbacks = [];
  const f = await repository({ after: callback => callbacks.push(callback) });
  cleanup.push(async () => {
    for (const callback of callbacks) await callback();
  });
  return f;
}
async function capture(page, name) {
  await expect(page.locator('#toast')).toBeHidden();
  await page.mouse.move(20, 20);
  await page.screenshot({ path: screenshotPath(name) });
}
async function settings(page) {
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('tab', { name: 'Backup', exact: true }).click();
}
async function parts(f) {
  const cache = await ReleaseDownloads.open({
    root: f.backup,
    volumeId: f.source.volumeId,
    scope: 'github:https://github.com:default:demo/project',
    chunkBytes: 64
  });
  await cache
    .download({
      identity: { id: 1, name: 'program-linux-x64.AppImage', tag: 'v1' },
      expectedName: 'program-linux-x64.AppImage',
      file: path.join(f.root, 'unused'),
      expectedSize: 320,
      request: async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(Buffer.alloc(192, 1));
              setTimeout(() => controller.error(new Error('interrupted')), 100);
            }
          }),
          { headers: { etag: '"fixture"' } }
        )
    })
    .catch(() => {});
  await cache.close();
}
test('architecture and multiple file-type filters persist with aligned controls and no preset sources', async () => {
  const config = defaults();
  config.checkUpdates = false;
  const a = await app({ config });
  await settings(a.page);
  await a.page.getByLabel('Releases with downloadable assets', { exact: true }).check();
  await a.page.getByLabel('Select release assets', { exact: true }).selectOption('all');
  await a.page.getByLabel('Processor architecture', { exact: true }).selectOption('arm64');
  await a.page.getByText('Choose file types', { exact: true }).click();
  await a.page.getByLabel('DMG', { exact: true }).check();
  await a.page.getByLabel('ZIP', { exact: true }).check();
  const boxes = await Promise.all(
    ['Processor architecture', 'Detected architecture'].map(label =>
      a.page.getByLabel(label, { exact: true }).boundingBox()
    )
  );
  expect(boxes[0].y).toBe(boxes[1].y);
  expect(boxes[0].height).toBe(boxes[1].height);
  await a.page.getByRole('button', { name: 'Save settings', exact: true }).click();
  await expect(a.page.locator('#toast')).toContainText('saved');
  await a.page.reload();
  await settings(a.page);
  await expect(a.page.getByLabel('Processor architecture', { exact: true })).toHaveValue('arm64');
  const state = await a.page.evaluate(() => window.gitCloner.getState());
  expect(state.config.backup.releaseFileTypes).toEqual(['dmg', 'zip']);
  expect(state.config.sources).toEqual([]);
  await a.page.getByText('Choose file types', { exact: true }).click();
  await a.page.getByLabel('DMG', { exact: true }).scrollIntoViewIfNeeded();
  await capture(a.page, 'architecture-filters.png');
});
test('automatic program installation is off by default and saves only an explicit single repository', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gc-install-ui-'));
  cleanup.push(() => fs.rm(root, { recursive: true, force: true }));
  const pattern =
    process.platform === 'darwin' ? '*.dmg' : process.platform === 'win32' ? '*portable*.exe' : '*.AppImage';
  const backup = path.join(root, 'backup'),
    programs = path.join(root, 'programs');
  await fs.mkdir(backup);
  await fs.mkdir(programs);
  const config = defaults();
  config.checkUpdates = false;
  const a = await app({ config });
  await a.page.getByRole('button', { name: 'Sources', exact: true }).click();
  await a.page.getByRole('button', { name: 'Add source', exact: true }).click();
  const dialog = a.page.getByRole('dialog', { name: 'Add source' });
  await dialog.locator('#source-values').fill('example/project');
  await dialog.locator('#source-destination').fill(backup);
  await dialog.getByText('Automatically install this program', { exact: true }).click();
  await expect(dialog.locator('#source-install-enabled')).not.toBeChecked();
  await dialog.locator('#source-install-enabled').check();
  await expect(dialog.locator('#source-release-scope')).toBeEnabled();
  await expect(dialog.locator('#source-release-scope')).toHaveValue('system');
  await dialog.getByLabel('Program destination folder', { exact: true }).fill(programs);
  await dialog.getByLabel('Release filename (optional)', { exact: true }).fill(pattern);
  const favoriteBox = await dialog.locator('.organization-favorite').boundingBox(),
    groupBox = await dialog.locator('#source-group').boundingBox();
  expect(favoriteBox.y).toBe(groupBox.y);
  expect(favoriteBox.height).toBe(groupBox.height);
  await dialog.locator('[data-action="close-dialog"]').last().scrollIntoViewIfNeeded();
  await capture(a.page, 'program-installation.png');
  await dialog.locator('#source-submit').click();
  await expect(dialog).not.toBeVisible();
  const state = await a.page.evaluate(() => window.gitCloner.getState());
  expect(state.config.sources[0].installation).toEqual({ enabled: true, destination: programs, pattern });
  expect(state.config.sources[0].backup.metadata.releases).toBe(true);
  expect(state.config.sources[0].backup.releaseScope).toBe('system');
  expect(state.config.backup.metadata.releases).toBe(false);
  await a.page.reload();
  await a.page.getByRole('button', { name: 'Sources', exact: true }).click();
  await a.page.getByRole('button', { name: 'example/project edit', exact: true }).click();
  await expect(a.page.locator('#source-install-enabled')).toBeChecked();
});
test('download storage previews, cancels and then cleans real parts while retaining a real backup', async () => {
  const f = await fixture(),
    record = await f.sync();
  await parts(f);
  const a = await app({ config: f.config(), state: { repositories: { [record.id]: record } } });
  await settings(a.page);
  await a.page.getByRole('button', { name: 'View download storage', exact: true }).click();
  const dialog = a.page.getByRole('dialog', { name: 'Downloads & storage' });
  await expect(dialog.locator('tbody tr')).toHaveCount(1);
  await expect(dialog).toContainText('demo/project');
  await dialog.locator('[data-storage-select]').check();
  await capture(a.page, 'download-storage.png');
  await dialog.getByRole('button', { name: 'Review cleanup', exact: true }).click();
  await expect(a.page.getByRole('dialog', { name: 'Review cleanup' })).toBeVisible();
  await a.page.getByRole('button', { name: 'Back', exact: true }).click();
  expect((await a.page.evaluate(() => window.gitCloner.downloadInventory())).entries).toHaveLength(1);
  await dialog.locator('#storage-select-page').uncheck();
  await expect(dialog.locator('[data-storage-select]')).not.toBeChecked();
  await dialog.locator('#storage-select-page').check();
  await expect(dialog.locator('[data-storage-select]')).toBeChecked();
  await dialog.getByRole('button', { name: 'Review cleanup', exact: true }).click();
  await a.page.getByRole('button', { name: 'Clean selected parts', exact: true }).click();
  await expect(dialog).toContainText('No removable download parts');
  expect(await fs.readFile(path.join(record.destination, 'README.md'), 'utf8')).toBe('  old text  \n');
});
test('a changed download cannot be deleted using an old GUI cleanup preview', async () => {
  const f = await fixture();
  await parts(f);
  const a = await app({ config: f.config() });
  await settings(a.page);
  await a.page.getByRole('button', { name: 'View download storage', exact: true }).click();
  const dialog = a.page.getByRole('dialog', { name: 'Downloads & storage' });
  await expect(dialog.locator('[data-storage-select]')).toHaveCount(1);
  await dialog.locator('[data-storage-select]').check();
  await dialog.getByRole('button', { name: 'Review cleanup', exact: true }).click();
  const { inventory } = require('../../app/core/download-storage.cjs'),
    entry = (await inventory([{ destination: f.backup, volumeId: f.source.volumeId }])).entries[0],
    file = path.join(entry.directory, 'parts.json'),
    meta = await readJson(file);
  meta.complete = true;
  await writeJson(file, meta);
  await a.page.getByRole('button', { name: 'Clean selected parts', exact: true }).click();
  await expect(a.page.locator('#storage-error')).toContainText('inzwischen');
  expect(await fs.stat(file)).toBeTruthy();
});
test('release filters remain aligned in English dark mode with large text', async () => {
  const config = defaults();
  config.checkUpdates = false;
  config.appearance = { language: 'en', theme: 'dark', fontScale: 1.3, highContrast: false };
  const a = await app({ config });
  await a.application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1040, 900));
  await a.page.getByRole('button', { name: 'Settings', exact: true }).click();
  await a.page.getByRole('tab', { name: 'Backup', exact: true }).click();
  await expect(a.page.getByLabel('Processor architecture', { exact: true })).toBeVisible();
  expect(
    await a.page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)
  ).toBe(true);
});
test('installation failures remain visible in overview filters and history alongside a successful backup', async () => {
  const f = await fixture(),
    record = await f.sync();
  record.installation = { status: 'error', message: 'Keine passende Prozessorarchitektur.', latestTag: 'v2' };
  const now = new Date().toISOString(),
    history = [
      {
        startedAt: now,
        finishedAt: now,
        trigger: 'manual',
        results: [record],
        resultCount: 1,
        errorCount: 1,
        changedCount: 1
      }
    ];
  const a = await app({ config: f.config(), state: { repositories: { [record.id]: record }, history } });
  await expect(a.page.locator('.program-status')).toContainText('Program installation failed');
  await a.page.getByLabel('Filter status', { exact: true }).selectOption('error');
  await expect(a.page.locator('#repository-list')).toContainText('demo/project');
  await expect(a.page.locator('#repository-list')).toContainText('Verified');
  await a.page.getByRole('button', { name: 'History', exact: true }).click();
  await a.page.getByLabel('Result', { exact: true }).selectOption('errors');
  await expect(a.page.locator('.history-table')).toContainText('1 errors');
  await a.page.getByRole('button', { name: 'Details', exact: true }).click();
  await expect(a.page.getByRole('dialog', { name: 'Results for this run' })).toContainText(
    'Keine passende Prozessorarchitektur.'
  );
});
