const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { launch, screenshotPath } = require('./helpers.cjs');
const { repository } = require('../helpers/repository.cjs');
const { DownloadHistory } = require('../../app/core/download-history.cjs');
const { defaults } = require('../../app/core/config.cjs');
const cleanup = [];
test.afterEach(async () => {
  while (cleanup.length) await cleanup.pop()();
});
async function app(options) {
  const a = await launch(options);
  cleanup.push(() => a.close());
  return a;
}
async function fixture() {
  const callbacks = [],
    f = await repository({ after: callback => callbacks.push(callback) });
  cleanup.push(async () => {
    for (const callback of callbacks) await callback();
  });
  f.programs = path.join(f.root, 'programs');
  f.desktop = path.join(f.root, 'Desktop');
  await fs.mkdir(f.programs);
  await fs.mkdir(f.desktop);
  f.source.installation = { enabled: true, destination: f.programs, pattern: '*.zip' };
  f.source.backup = { ...defaults().backup, metadata: { ...defaults().backup.metadata, releases: true } };
  f.preview = {
    tag: 'v1.0.0',
    asset: 'example-suite.zip',
    digest: 'a'.repeat(64),
    candidates: [
      { key: 'Writer.app', name: 'Writer', available: true },
      { key: 'Viewer.app', name: 'Viewer', available: true },
      {
        key: 'Legacy.app',
        name: 'Legacy',
        available: false,
        message: 'Diese App passt nicht zur Prozessorarchitektur.'
      }
    ]
  };
  return f;
}
async function editor(a) {
  await a.page.getByRole('button', { name: 'Sources', exact: true }).click();
  await a.page.getByRole('button', { name: 'demo/project edit', exact: true }).first().click();
  const dialog = a.page.getByRole('dialog', { name: 'Edit source' });
  await dialog.getByText('Automatically install this program', { exact: true }).click();
  return dialog;
}
async function history(a, english = false) {
  await a.page.getByRole('button', { name: english ? 'Settings' : 'Settings', exact: true }).click();
  await a.page.getByRole('tab', { name: english ? 'Backup' : 'Backup', exact: true }).click();
  await a.page
    .getByRole('button', { name: english ? 'View download history' : 'View download history', exact: true })
    .click();
  return a.page.getByRole('dialog', { name: english ? 'Download history' : 'Download history', exact: true });
}
async function screenshot(page, name) {
  await page.mouse.move(20, 20);
  await page.screenshot({ path: screenshotPath(name) });
}
test('multiple archive programs and optional shortcuts persist only after explicit source save', async () => {
  const f = await fixture(),
    a = await app({ config: f.config(), programCandidates: f.preview }),
    dialog = await editor(a);
  await expect(dialog.getByLabel('Create program shortcuts')).not.toBeChecked();
  await dialog.getByRole('button', { name: 'Choose programs from backup', exact: true }).click();
  const picker = a.page.getByRole('dialog', { name: 'Choose programs', exact: true });
  await expect(picker.getByRole('button', { name: 'Apply selection' })).toBeDisabled();
  await expect(picker.getByLabel('Legacy')).toBeDisabled();
  await picker.locator('[data-program-key="Writer.app"]').check();
  await picker.locator('[data-program-key="Viewer.app"]').check();
  await expect(picker.locator('#program-count')).toContainText('2');
  await screenshot(a.page, 'multiple-programs.png');
  await picker.getByRole('button', { name: 'Apply selection' }).click();
  await expect(dialog.locator('#source-program-summary')).toContainText('2 programs');
  await dialog.getByLabel('Create program shortcuts').check();
  await dialog.getByLabel('Shortcut folder', { exact: true }).fill(f.desktop);
  await dialog.getByLabel('Shortcut folder', { exact: true }).scrollIntoViewIfNeeded();
  await screenshot(a.page, 'program-shortcuts.png');
  await dialog.locator('#source-submit').click();
  await expect(dialog).toBeHidden();
  const config = (await a.page.evaluate(() => window.gitCloner.getState())).config;
  expect(config.sources[0].installation.programs).toEqual(['Viewer.app', 'Writer.app']);
  expect(config.sources[0].installation.shortcut).toEqual({ enabled: true, destination: f.desktop });
  await a.page.reload();
  const reopened = await editor(a);
  await expect(reopened.locator('#source-program-summary')).toContainText('2 programs');
  await expect(reopened.getByLabel('Create program shortcuts')).toBeChecked();
});
test('canceling or resetting a program selection leaves the saved configuration intact until save', async () => {
  const f = await fixture();
  f.source.installation.programs = ['Writer.app'];
  const a = await app({ config: f.config(), programCandidates: f.preview }),
    dialog = await editor(a);
  await dialog.getByRole('button', { name: 'Choose programs from backup' }).click();
  const picker = a.page.getByRole('dialog', { name: 'Choose programs', exact: true });
  await picker.locator('[data-program-key="Viewer.app"]').check();
  await picker.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog.locator('#source-program-summary')).toContainText('1 program');
  await dialog.getByRole('button', { name: 'Automatic selection', exact: true }).click();
  await expect(dialog.locator('#source-program-summary')).toContainText('Automatic selection');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect((await a.page.evaluate(() => window.gitCloner.getState())).config.sources[0].installation.programs).toEqual([
    'Writer.app'
  ]);
});
test('download history has aligned filters, real persisted totals, pagination and private encrypted filenames', async () => {
  const f = await fixture(),
    log = new DownloadHistory(path.join(f.directory, 'download-history.json'));
  await log.append(
    Array.from({ length: 75 }, (_, index) => ({
      fullName: 'example/project-' + index,
      name: 'program-' + index + '.zip',
      status: 'downloaded',
      networkBytes: 1024
    }))
  );
  await log.append([
    { fullName: 'example/private', name: 'secret-program.zip', encrypted: true, status: 'reused', reusedBytes: 4096 },
    { status: 'cleaned', freedBytes: 2048 }
  ]);
  await log.flush();
  const a = await app({ directory: f.directory, config: f.config() }),
    dialog = await history(a);
  await expect(dialog.getByText('77 matches', { exact: false })).toBeVisible();
  await expect(dialog.locator('tbody tr')).toHaveCount(50);
  await expect(dialog.getByText('secret-program.zip')).toHaveCount(0);
  const boxes = await Promise.all(
    ['Search repository or file', 'Result', 'Period'].map(label =>
      dialog.getByLabel(label, { exact: true }).boundingBox()
    )
  );
  for (const box of boxes) {
    expect(box.y).toBe(boxes[0].y);
    expect(box.height).toBe(boxes[0].height);
  }
  await screenshot(a.page, 'download-history.png');
  await dialog.locator('[data-action="download-history-next"]').click();
  await expect(dialog.locator('tbody tr')).toHaveCount(27);
  await dialog.getByLabel('Search repository or file', { exact: true }).fill('project-74');
  await expect(dialog.locator('tbody tr')).toHaveCount(1);
  await expect(dialog.getByLabel('Search repository or file', { exact: true })).toBeFocused();
  await dialog.getByLabel('Result', { exact: true }).selectOption('reused');
  await expect(dialog.getByText('No matching download entries yet.')).toBeVisible();
  await dialog.getByLabel('Search repository or file', { exact: true }).fill('');
  await expect(dialog.getByText('Encrypted release file')).toBeVisible();
  await expect(dialog.locator('.download-storage-summary')).toContainText('4 KiB');
});
test('download history survives an actual Electron restart without adding preset repositories', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gc-history-ui-'));
  cleanup.push(() => fs.rm(root, { recursive: true, force: true }));
  const config = defaults();
  config.checkUpdates = false;
  const log = new DownloadHistory(path.join(root, 'download-history.json'));
  await log.append([{ status: 'cached', fullName: 'example/project', name: 'Example.zip', resumedBytes: 8192 }]);
  await log.flush();
  const first = await launch({ directory: root, config });
  await history(first);
  await expect(first.page.getByText('Example.zip', { exact: true })).toBeVisible();
  await first.close({ preserve: true });
  const second = await app({ directory: root });
  await history(second);
  await expect(second.page.getByText('Example.zip', { exact: true })).toBeVisible();
  expect((await second.page.evaluate(() => window.gitCloner.getState())).config.sources).toEqual([]);
});
test('English dark history remains aligned at large font size without page overflow', async () => {
  const f = await fixture(),
    config = f.config();
  config.appearance = { ...config.appearance, language: 'en', theme: 'dark', fontScale: 1.3 };
  const log = new DownloadHistory(path.join(f.directory, 'download-history.json'));
  await log.append([
    {
      fullName: 'example/very-long-project-name',
      name: 'Example-program-macos-universal.zip',
      status: 'resumed',
      networkBytes: 4096,
      resumedBytes: 16384
    }
  ]);
  await log.flush();
  const a = await app({ directory: f.directory, config }),
    dialog = await history(a, true);
  await expect(dialog.locator('tbody').getByText('Resumed', { exact: true })).toBeVisible();
  const boxes = await Promise.all(
    ['Search repository or file', 'Result', 'Period'].map(label =>
      dialog.getByLabel(label, { exact: true }).boundingBox()
    )
  );
  for (const box of boxes) {
    expect(box.y).toBe(boxes[0].y);
    expect(box.height).toBe(boxes[0].height);
  }
  expect(await a.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await screenshot(a.page, 'download-history-dark.png');
});
