const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { launch, screenshotPath } = require('./helpers.cjs');
const { defaults } = require('../../app/core/config.cjs');
const { repository } = require('../helpers/repository.cjs');
const cleanup = [];
test.afterEach(async () => {
  while (cleanup.length) await cleanup.pop()();
});
async function app(options) {
  const value = await launch(options);
  cleanup.push(() => value.close());
  return value;
}
async function fixture() {
  const callbacks = [],
    value = await repository({ after: fn => callbacks.push(fn) });
  cleanup.push(async () => {
    for (const fn of callbacks) await fn();
  });
  return value;
}
async function capture(page, name) {
  await page.screenshot({
    path: screenshotPath(name),
    fullPage: !(await page.locator('dialog[open]').count())
  });
}
async function save(page) {
  await page.getByRole('button', { name: 'Save settings', exact: true }).click();
  await expect(page.locator('#toast')).toHaveText('Settings saved.');
}
test('release settings detect the real OS, align fields and retain the selected platform filter', async () => {
  const f = await app();
  await f.page.getByRole('button', { name: 'Settings', exact: true }).click();
  await f.page.getByRole('tab', { name: 'Backup', exact: true }).click();
  await expect(f.page.getByLabel('Select release assets', { exact: true })).toBeDisabled();
  await f.page.getByLabel('Releases with downloadable assets').check();
  await f.page.getByLabel('Select release assets', { exact: true }).selectOption('system');
  await expect(f.page.getByLabel('Automatically detected system')).toHaveValue(
    { darwin: 'macOS', win32: 'Windows', linux: 'Linux' }[process.platform]
  );
  const boxes = await Promise.all(
    ['Select release assets', 'Automatically detected system'].map(label =>
      f.page.getByLabel(label, { exact: true }).boundingBox()
    )
  );
  expect(Math.abs(boxes[0].y - boxes[1].y)).toBeLessThan(1);
  expect(boxes[0].height).toBe(boxes[1].height);
  await capture(f.page, 'release-filter.png');
  await save(f.page);
  await f.page.reload();
  await f.page.getByRole('button', { name: 'Settings', exact: true }).click();
  await f.page.getByRole('tab', { name: 'Backup', exact: true }).click();
  await expect(f.page.getByLabel('Select release assets', { exact: true })).toHaveValue('system');
});
test('a source saves its own three check times and release filter while the global schedule remains unchanged', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gc-source-schedule-ui-'));
  cleanup.push(() => fs.rm(root, { recursive: true, force: true }));
  const f = await app();
  await f.page.getByRole('button', { name: 'Sources', exact: true }).click();
  await f.page.getByRole('button', { name: 'Add source', exact: true }).first().click();
  await f.page.getByLabel('GitHub account or repository').fill('example-account/project');
  await f.page.getByLabel('Destination folder on your drive').fill(root);
  await f.page.getByText('Backup content for this source', { exact: true }).click();
  await f.page.getByLabel('Use source-specific backup options').check();
  await f.page.getByRole('checkbox', { name: 'Releases and assets', exact: true }).check();
  await f.page.getByLabel('Select release assets', { exact: true }).selectOption('system');
  await f.page.getByText('Check times for this source', { exact: true }).click();
  await f.page.getByLabel('Use source-specific check times').check();
  await f.page.getByLabel('Daily checks for this source').selectOption('3');
  const times = f.page.locator('[data-source-time]');
  await expect(times).toHaveCount(3);
  for (const [i, value] of ['01:00', '09:00', '17:00'].entries()) await times.nth(i).fill(value);
  const boxes = await Promise.all(
    ['Daily checks for this source', 'Run automatically'].map(label =>
      f.page.getByLabel(label, { exact: true }).boundingBox()
    )
  );
  expect(Math.abs(boxes[0].y - boxes[1].y)).toBeLessThan(1);
  expect(boxes[0].height).toBe(boxes[1].height);
  await f.page
    .getByText('Check times for this source', { exact: true })
    .locator('..')
    .screenshot({ path: screenshotPath('source-schedule.png') });
  await f.page.getByRole('dialog').getByRole('button', { name: 'Add source', exact: true }).click();
  await expect(f.page.getByRole('dialog')).not.toBeVisible();
  const state = await f.page.evaluate(() => window.gitCloner.getState());
  expect(state.config.sources[0].schedule.times).toEqual(['01:00', '09:00', '17:00']);
  expect(state.config.sources[0].backup.releaseScope).toBe('system');
  expect(state.config.schedule.times).toEqual(['02:00']);
  await expect(f.page.locator('#main-content')).toContainText('custom times');
});
test('notification rules and overnight quiet hours persist with equally aligned time inputs', async () => {
  const f = await app();
  await f.page.getByRole('button', { name: 'Settings', exact: true }).click();
  await f.page.getByRole('tab', { name: 'Notifications', exact: true }).click();
  await f.page.getByLabel('Backup notifications').selectOption('errors');
  await f.page.getByLabel('New application versions').selectOption('no');
  await f.page.getByLabel('Enable quiet hours').check();
  await f.page.getByLabel('Quiet hours start').fill('22:00');
  await f.page.getByLabel('Quiet hours end').fill('07:00');
  const boxes = await Promise.all(
    ['Quiet hours start', 'Quiet hours end'].map(label => f.page.getByLabel(label).boundingBox())
  );
  expect(boxes[0].y).toBe(boxes[1].y);
  expect(boxes[0].height).toBe(boxes[1].height);
  await capture(f.page, 'notification-rules.png');
  await save(f.page);
  await f.page.reload();
  await f.page.getByRole('button', { name: 'Settings', exact: true }).click();
  await f.page.getByRole('tab', { name: 'Notifications', exact: true }).click();
  await expect(f.page.getByLabel('Backup notifications')).toHaveValue('errors');
  const state = await f.page.evaluate(() => window.gitCloner.getState());
  expect(state.config.notificationRules).toMatchObject({
    backup: 'errors',
    updates: false,
    quietHours: { enabled: true, start: '22:00', end: '07:00' }
  });
});
test('notification settings fit English large text and dark mode without horizontal page overflow', async () => {
  const config = defaults();
  config.appearance = { language: 'en', theme: 'dark', fontScale: 1.3, highContrast: false };
  const f = await app({ config });
  await f.application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1040, 900));
  await f.page.getByRole('button', { name: 'Settings', exact: true }).click();
  await f.page.getByRole('tab', { name: 'Notifications', exact: true }).click();
  expect(
    await f.page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)
  ).toBe(true);
  await expect(f.page.getByLabel('Backup notifications')).toBeVisible();
});
test('the change dialog displays real Git differences safely and releases the operation when closed', async () => {
  const source = await fixture();
  await fs.writeFile(path.join(source.remote, 'project.json'), '{\n  "version": "1.0.0"\n}\n');
  await source.command('add', '.');
  await source.command('commit', '-m', 'project settings');
  const record = await source.sync();
  await fs.writeFile(path.join(source.remote, 'project.json'), '{\n  "version": "1.1.0"\n}\n');
  await fs.writeFile(
    path.join(source.remote, 'README.md'),
    '  changed text  \n<img src=x onerror="window.previewInjected=true">\n'
  );
  await source.command('add', '.');
  await source.command('commit', '-m', 'updated');
  const head = (await source.command('rev-parse', 'HEAD')).stdout.trim(),
    commit = await source.github.request(`/repos/demo/project/git/commits/${head}`),
    tree = await source.github.request(`/repos/demo/project/git/trees/${commit.tree.sha}?recursive=1`),
    entry = tree.tree.find(e => e.path === 'README.md');
  const api = {};
  api[`/repos/demo/project/git/commits/${head}`] = commit;
  api[`/repos/demo/project/git/trees/${commit.tree.sha}?recursive=1`] = tree;
  api[`/repos/demo/project/git/blobs/${entry.sha}`] = await source.github.request(
    `/repos/demo/project/git/blobs/${entry.sha}`
  );
  const settings = tree.tree.find(e => e.path === 'project.json');
  api[`/repos/demo/project/git/blobs/${settings.sha}`] = await source.github.request(
    `/repos/demo/project/git/blobs/${settings.sha}`
  );
  const f = await app({
    config: source.config(),
    state: { repositories: { [record.id]: record } },
    repositories: [source.repository],
    api,
    remotes: { 'https://github.com/demo/project.git': pathToFileURL(source.remote).href }
  });
  await f.page.getByRole('button', { name: 'Review changes', exact: true }).click();
  const dialog = f.page.getByRole('dialog', { name: 'Review changes before backup' });
  await expect(dialog.getByRole('button', { name: 'README.md', exact: true })).toBeVisible();
  await expect(dialog.locator('#changes-patch')).toContainText('Choose a file');
  await dialog.getByRole('button', { name: 'README.md', exact: true }).click();
  await expect(dialog.locator('.patch-code')).toContainText('+  changed text');
  await expect(dialog.locator('#changes-patch img')).toHaveCount(0);
  expect(await f.page.evaluate(() => window.previewInjected)).toBeUndefined();
  expect((await f.page.evaluate(() => window.gitCloner.getState())).operation).toBe('previewing-changes');
  await dialog.getByRole('button', { name: 'project.json', exact: true }).click();
  await expect(dialog.locator('.patch-code')).toContainText('1.1.0');
  await capture(f.page, 'change-preview.png');
  await dialog.locator('[data-action="changes-close"]').last().click();
  await expect.poll(async () => (await f.page.evaluate(() => window.gitCloner.getState())).operation).toBe(null);
  expect(await source.git.head(record.destination)).toBe(record.commit);
});
test('release assets can be restored independently through the dedicated overview action', async () => {
  const source = await fixture(),
    asset = source.asset(1, 'package.zip', 'installer payload');
  source.releases = [{ tag_name: 'v1.0', assets: [asset] }];
  source.options.metadata.releases = true;
  const record = await source.sync(),
    f = await app({ config: source.config(), state: { repositories: { [record.id]: record } } });
  await f.page.getByRole('button', { name: 'Restore release assets', exact: true }).click();
  await expect(f.page.getByLabel('Restore scope')).toHaveValue('releases');
  await f.page.getByRole('button', { name: 'Choose files', exact: true }).click();
  await f.page.getByRole('checkbox', { name: 'package.zip select', exact: true }).check();
  await f.page.getByLabel('Parent folder').fill(source.root);
  await f.page.getByLabel('New folder name').fill('release-copy');
  await f.page.getByRole('button', { name: 'Verify & restore' }).click();
  await expect(f.page.locator('#restore-result')).toContainText('Verified and restored successfully');
  expect(await fs.readdir(path.join(source.root, 'release-copy'))).toEqual(['package.zip']);
  expect(await fs.readFile(path.join(source.root, 'release-copy', 'package.zip'), 'utf8')).toBe('installer payload');
  await capture(f.page, 'release-restore.png');
});
test('the GUI finds a renamed mounted drive without creating a replacement directory at the old path', async () => {
  const source = await fixture(),
    record = await source.sync(),
    mount = path.join(source.root, 'renamed-drive'),
    f = await app({ config: source.config(), state: { repositories: { [record.id]: record } }, mounts: [mount] });
  await fs.rename(source.mount, mount);
  await f.page.getByRole('button', { name: 'Sources', exact: true }).click();
  await f.page.getByRole('button', { name: 'Find drives', exact: true }).click();
  await expect(f.page.locator('#main-content')).toContainText(path.join(mount, 'backups'));
  const state = await f.page.evaluate(() => window.gitCloner.getState());
  expect(state.driveRecovery.moved).toBe(1);
  await expect(f.page.locator('.drive-notice')).toContainText('Kennung wiedergefunden');
  await expect(f.page.locator('#main-content')).toContainText(path.join(mount, 'backups'));
  await expect
    .poll(async () =>
      fs.stat(source.mount).then(
        () => true,
        () => false
      )
    )
    .toBe(false);
  await capture(f.page, 'drive-recovery.png');
});
