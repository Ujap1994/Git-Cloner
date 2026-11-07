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
async function app(options = {}) {
  const result = await launch(options);
  cleanup.push(() => result.close());
  return result;
}
async function directory() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gc-workspace-ui-'));
  cleanup.push(() => fs.rm(root, { recursive: true, force: true }));
  return root;
}
async function capture(page, name) {
  await expect(page.locator('#toast')).toBeHidden();
  await page.mouse.move(20, 20);
  await page.screenshot({ path: screenshotPath(name) });
}
function configured(root, count = 3) {
  const config = defaults();
  config.checkUpdates = false;
  config.sources = Array.from({ length: count }, (_, index) => ({
    id: `source-${index}`,
    kind: 'repository',
    value: `example/project-${index + 1}`,
    destination: root,
    enabled: true
  }));
  return config;
}
async function sources(page) {
  await page.getByRole('button', { name: 'Sources', exact: true }).click();
}

test('repository picker starts empty, aligns its controls and saves an explicit cross-search selection', async () => {
  const root = await directory(),
    config = defaults();
  config.checkUpdates = false;
  config.sourceGroups = [{ id: 'projects', name: 'Beispielgruppe' }];
  const repositories = ['alpha', 'beta', 'gamma'].map((name, index) => ({
    full_name: `example/${name}`,
    private: index === 1,
    fork: index === 2,
    description: `Example project ${name}`,
    owner: { login: 'example' }
  }));
  const a = await app({
    config,
    repositories,
    api: { '/search/repositories': { total_count: 1, items: [repositories[1]] } }
  });
  expect((await a.page.evaluate(() => window.gitCloner.getState())).config.sources).toEqual([]);
  await sources(a.page);
  await a.page.getByRole('button', { name: 'Choose repositories', exact: true }).first().click();
  const dialog = a.page.getByRole('dialog', { name: 'Choose repositories' });
  await expect(dialog.getByLabel('Owner / organization / group')).toHaveValue('');
  const boxes = await Promise.all(
    ['Provider', 'Server'].map(label => dialog.getByLabel(label, { exact: true }).boundingBox())
  );
  expect(boxes[0].y).toBe(boxes[1].y);
  expect(boxes[0].height).toBe(boxes[1].height);
  await dialog.getByLabel('Owner / organization / group').fill('example');
  await dialog.getByRole('button', { name: 'Load', exact: true }).click();
  await expect(dialog.locator('tbody tr')).toHaveCount(3);
  await dialog.getByLabel('example/alpha select', { exact: true }).check();
  await dialog.getByLabel('Search repositories', { exact: true }).fill('beta');
  await expect(dialog.locator('tbody tr')).toHaveCount(1);
  await dialog.getByLabel('example/beta select', { exact: true }).check();
  await expect(dialog.locator('#browser-selected')).toContainText('2 selected');
  await expect(dialog.locator('tbody')).toContainText('Private');
  await dialog.getByLabel('Shared destination', { exact: true }).fill(root);
  await dialog.getByLabel('Group for this selection').selectOption('projects');
  await dialog.getByLabel('Mark selection as favorites').check();
  await capture(a.page, 'repository-browser.png');
  expect(
    await fs.stat(path.join(root, '.git-cloner-volume.json')).then(
      () => true,
      () => false
    )
  ).toBe(false);
  await dialog.getByRole('button', { name: 'Add 2 sources', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const saved = (await a.page.evaluate(() => window.gitCloner.getState())).config;
  expect(saved.sources.map(source => source.value)).toEqual(['example/alpha', 'example/beta']);
  expect(saved.sources.every(source => source.groupId === 'projects' && source.favorite)).toBe(true);
  expect(await fs.readdir(root)).toEqual(['.git-cloner-volume.json']);
});
test('repository picker pages lazily and retains selections across pages', async () => {
  const root = await directory(),
    config = defaults();
  config.checkUpdates = false;
  const repositories = Array.from({ length: 51 }, (_, index) => ({
    full_name: `example/project-${index + 1}`,
    owner: { login: 'example' }
  }));
  const a = await app({ config, repositories });
  await sources(a.page);
  await a.page.getByRole('button', { name: 'Choose repositories', exact: true }).first().click();
  const dialog = a.page.getByRole('dialog', { name: 'Choose repositories' });
  await dialog.getByLabel('Owner / organization / group').fill('example');
  await dialog.getByRole('button', { name: 'Load', exact: true }).click();
  await expect(dialog.locator('tbody tr')).toHaveCount(50);
  await dialog.getByLabel('example/project-1 select', { exact: true }).check();
  await dialog.locator('[data-action="browser-next"]').click();
  await expect(dialog.locator('tbody tr')).toHaveCount(1);
  await dialog.getByLabel('example/project-51 select', { exact: true }).check();
  await dialog.locator('[data-action="browser-previous"]').click();
  await expect(dialog.getByLabel('example/project-1 select', { exact: true })).toBeChecked();
  await expect(dialog.locator('#browser-selected')).toContainText('2 selected');
  await dialog.getByLabel('Shared destination', { exact: true }).fill(root);
  await dialog.getByRole('button', { name: 'Add 2 sources', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect((await a.page.evaluate(() => window.gitCloner.getState())).config.sources).toHaveLength(2);
});
test('changing the picker owner requires an explicit reload before sources can be added', async () => {
  const config = defaults();
  config.checkUpdates = false;
  const a = await app({ config, repositories: [{ full_name: 'example/alpha', owner: { login: 'example' } }] });
  await sources(a.page);
  await a.page.getByRole('button', { name: 'Choose repositories', exact: true }).first().click();
  const dialog = a.page.getByRole('dialog');
  await dialog.getByLabel('Owner / organization / group').fill('example');
  await dialog.getByRole('button', { name: 'Load', exact: true }).click();
  await dialog.getByLabel('example/alpha select', { exact: true }).check();
  await dialog.getByLabel('Owner / organization / group').fill('other-example');
  await expect(dialog.locator('#browser-add')).toBeDisabled();
  await expect(dialog.locator('#browser-selected')).toContainText('erneut laden');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect((await a.page.evaluate(() => window.gitCloner.getState())).config.sources).toEqual([]);
});
test('groups and favorites persist after restart and can filter the source list', async () => {
  const root = await directory(),
    first = await app({ config: configured(root) });
  await sources(first.page);
  await first.page.getByRole('button', { name: 'Manage groups', exact: true }).first().click();
  const groups = first.page.getByRole('dialog', { name: 'Manage groups' });
  await groups.getByLabel('New group name').fill('Beispielgruppe');
  await groups.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(groups.locator('.workspace-group-form')).toHaveCount(1);
  await groups.getByRole('button', { name: 'Close', exact: true }).click();
  await first.page.getByLabel('example/project-1 select', { exact: true }).check();
  await first.page.getByLabel('example/project-2 select', { exact: true }).check();
  const groupId = (await first.page.evaluate(() => window.gitCloner.getState())).config.sourceGroups[0].id;
  await first.page.getByLabel('Group selected sources').selectOption(groupId);
  await expect(first.page.locator('.source-group-badge')).toHaveCount(2);
  await first.page.getByRole('button', { name: 'example/project-1 mark as favorite', exact: true }).click();
  await expect(first.page.locator('.is-favorite')).toHaveCount(1);
  await capture(first.page, 'source-groups.png');
  cleanup.pop();
  await first.close({ preserve: true });
  const second = await app({ directory: first.directory });
  await sources(second.page);
  await second.page.getByRole('button', { name: 'Favorites', exact: true }).click();
  await expect(second.page.locator('.source-table tbody tr')).toHaveCount(1);
  await expect(second.page.locator('.source-table')).toContainText('example/project-1');
  await second.page.getByRole('button', { name: 'Favorites', exact: true }).click();
  await second.page.getByLabel('Filter by group').selectOption(groupId);
  await expect(second.page.locator('.source-table tbody tr')).toHaveCount(2);
});
test('bulk editor previews changes and preserves per-source differences and unselected sources', async () => {
  const root = await directory(),
    config = configured(root);
  config.sources[0].backup = { ...config.backup, lfs: true };
  const a = await app({ config });
  await sources(a.page);
  await a.page.getByLabel('example/project-1 select', { exact: true }).check();
  await a.page.getByLabel('example/project-2 select', { exact: true }).check();
  await a.page.getByRole('button', { name: 'Edit together', exact: true }).click();
  const dialog = a.page.getByRole('dialog', { name: 'Edit together' });
  const boxes = await Promise.all(
    ['Group', 'Source status'].map(label => dialog.getByLabel(label, { exact: true }).boundingBox())
  );
  expect(boxes[0].y).toBe(boxes[1].y);
  expect(boxes[0].height).toBe(boxes[1].height);
  await dialog.getByLabel('Source status', { exact: true }).selectOption('false');
  await dialog.locator('summary').filter({ hasText: 'Repository filters' }).click();
  await dialog.getByLabel('Include forks', { exact: true }).selectOption('false');
  await dialog.locator('summary').filter({ hasText: 'Backup content' }).click();
  await dialog.getByLabel('Backup options', { exact: true }).selectOption('custom');
  await dialog.getByLabel('Issues', { exact: true }).selectOption('true');
  await dialog.getByRole('button', { name: 'Review changes', exact: true }).click();
  await expect(dialog.locator('.bulk-preview-card')).toHaveCount(2);
  await expect(dialog.locator('#bulk-preview')).toContainText('LFS on');
  await expect(dialog.locator('#bulk-preview')).toContainText('LFS aus');
  await capture(a.page, 'bulk-preview.png');
  expect(
    (await a.page.evaluate(() => window.gitCloner.getState())).config.sources.every(source => source.enabled)
  ).toBe(true);
  await dialog.getByRole('button', { name: 'Apply changes', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const saved = (await a.page.evaluate(() => window.gitCloner.getState())).config;
  expect(
    saved.sources
      .slice(0, 2)
      .every(source => !source.enabled && !source.filters.includeForks && source.backup.metadata.issues)
  ).toBe(true);
  expect(saved.sources[0].backup.lfs).toBe(true);
  expect(saved.sources[1].backup.lfs).toBe(false);
  expect(saved.sources[2].enabled).toBe(true);
  expect(saved.sources[2].backup).toBe(null);
});
test('cancelling a bulk preview writes nothing and a stale preview cannot apply', async () => {
  const root = await directory(),
    a = await app({ config: configured(root) });
  await sources(a.page);
  await a.page.getByLabel('example/project-1 select', { exact: true }).check();
  await a.page.getByRole('button', { name: 'Edit together', exact: true }).click();
  let dialog = a.page.getByRole('dialog', { name: 'Edit together' });
  await dialog.getByLabel('Source status', { exact: true }).selectOption('false');
  await dialog.getByRole('button', { name: 'Review changes', exact: true }).click();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect((await a.page.evaluate(() => window.gitCloner.getState())).config.sources[0].enabled).toBe(true);
  await a.page.getByRole('button', { name: 'Edit together', exact: true }).click();
  dialog = a.page.getByRole('dialog', { name: 'Edit together' });
  await dialog.getByLabel('Source status', { exact: true }).selectOption('false');
  await dialog.getByRole('button', { name: 'Review changes', exact: true }).click();
  await a.page.evaluate(() => window.gitCloner.organizeSources({ ids: ['source-0'], favorite: true }));
  await dialog.getByRole('button', { name: 'Apply changes', exact: true }).click();
  await expect(dialog.locator('#bulk-error')).toContainText('changed in the meantime');
  expect((await a.page.evaluate(() => window.gitCloner.getState())).config.sources[0].enabled).toBe(true);
});
test('source controls remain usable in English dark mode with large text', async () => {
  const root = await directory(),
    config = configured(root, 30);
  config.appearance = { language: 'en', theme: 'dark', fontScale: 1.3, highContrast: false };
  const a = await app({ config });
  await a.application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1040, 900));
  await a.page.getByRole('button', { name: 'Sources', exact: true }).click();
  await expect(a.page.locator('.source-table tbody tr')).toHaveCount(25);
  expect(
    await a.page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)
  ).toBe(true);
  await a.page.getByRole('button', { name: 'Choose repositories', exact: true }).click();
  const dialog = a.page.getByRole('dialog', { name: 'Choose repositories' });
  await expect(dialog.getByLabel('Owner / organization / group')).toBeVisible();
  expect(
    await a.page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)
  ).toBe(true);
  const boxes = await Promise.all(
    ['Provider', 'Server'].map(label => dialog.getByLabel(label, { exact: true }).boundingBox())
  );
  expect(boxes[0].y).toBe(boxes[1].y);
  expect(boxes[0].height).toBe(boxes[1].height);
  await capture(a.page, 'workspace-dark.png');
});
test('background progress does not replace the source search or lose keyboard focus', async () => {
  const callbacks = [],
    f = await repository({ after: callback => callbacks.push(callback) });
  cleanup.push(async () => {
    for (const callback of callbacks) await callback();
  });
  const a = await app({
    config: f.config(),
    repositories: [f.repository],
    remotes: { 'https://github.com/demo/project.git': pathToFileURL(f.remote).href }
  });
  await sources(a.page);
  await a.page.getByLabel('Search sources', { exact: true }).fill('demo');
  await a.page.evaluate(() => window.gitCloner.runBackup());
  await a.page.getByLabel('Search sources', { exact: true }).focus();
  await expect.poll(() => a.page.evaluate(async () => (await window.gitCloner.getState()).busy)).toBe(true);
  await expect.poll(() => a.page.evaluate(async () => (await window.gitCloner.getState()).busy)).toBe(false);
  await expect(a.page.getByLabel('Search sources', { exact: true })).toBeFocused();
  await expect(a.page.getByLabel('Search sources', { exact: true })).toHaveValue('demo');
});

test('pasted repository URLs immediately display only owner and repository', async () => {
  const root = await directory(),
    config = defaults();
  config.checkUpdates = false;
  const a = await app({ config });
  await sources(a.page);
  await a.page.getByRole('button', { name: 'Add source', exact: true }).click();
  const dialog = a.page.getByRole('dialog', { name: 'Add source' });
  await dialog.locator('#source-values').evaluate(input => {
    const data = new DataTransfer();
    data.setData('text/plain', 'https://github.com/example/project.git/');
    input.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
  });
  await expect(dialog.locator('#source-values')).toHaveValue('example/project');
  await dialog.locator('#source-destination').fill(root);
  await dialog.locator('#source-submit').click();
  await expect(dialog).not.toBeVisible();
  expect((await a.page.evaluate(() => window.gitCloner.getState())).config.sources[0].value).toBe('example/project');
});
test('an organization URL lists repositories as a dynamic owner source and repeated entry preserves existing rules', async () => {
  const root = await directory(),
    config = configured(root, 1);
  config.sources[0].enabled = false;
  const repositories = ['project-1', 'new-project'].map(name => ({
    full_name: `example/${name}`,
    owner: { login: 'example' }
  }));
  const a = await app({ config, repositories });
  await sources(a.page);
  async function pasteOwner() {
    await a.page.getByRole('button', { name: 'Add source', exact: true }).click();
    await a.page.locator('#source-destination').fill(root);
    await a.page.locator('#source-values').evaluate(input => {
      const data = new DataTransfer();
      data.setData('text/plain', 'https://github.com/orgs/example/repositories');
      input.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
    });
  }
  await pasteOwner();
  const dialog = a.page.getByRole('dialog', { name: 'Choose repositories' });
  await expect(dialog.locator('tbody tr')).toHaveCount(2);
  await expect(dialog.getByLabel('Owner / organization / group')).toHaveValue('example');
  await expect(dialog.getByLabel('Automatically include new repositories')).toBeChecked();
  await expect(dialog.getByLabel('example/new-project select', { exact: true })).toBeChecked();
  await expect(dialog.getByLabel('example/project-1 select', { exact: true })).not.toBeChecked();
  await expect(dialog.locator('tbody')).toContainText('Individual rule paused');
  await capture(a.page, 'owner-source.png');
  await dialog.getByRole('button', { name: 'Add owner source', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  let saved = (await a.page.evaluate(() => window.gitCloner.getState())).config.sources;
  expect(saved).toHaveLength(2);
  expect(saved[1].kind).toBe('owner');
  expect(saved[0].enabled).toBe(false);
  await pasteOwner();
  await expect(dialog.locator('tbody tr')).toHaveCount(2);
  await dialog.getByRole('button', { name: 'Keep existing source', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  saved = (await a.page.evaluate(() => window.gitCloner.getState())).config.sources;
  expect(saved).toHaveLength(2);
  expect(saved[0].enabled).toBe(false);
  await a.page.getByRole('button', { name: 'Show repositories', exact: true }).click();
  await expect(dialog.locator('tbody tr')).toHaveCount(2);
  await expect(dialog.getByLabel('Automatically include new repositories')).toBeChecked();
});
test('select all missing spans pages and preserves existing repository rules', async () => {
  const root = await directory(),
    config = configured(root, 1),
    repositories = Array.from({ length: 51 }, (_, i) => ({
      full_name: `example/project-${i + 1}`,
      owner: { login: 'example' }
    }));
  const a = await app({ config, repositories });
  await sources(a.page);
  await a.page.getByRole('button', { name: 'Choose repositories', exact: true }).click();
  const dialog = a.page.getByRole('dialog', { name: 'Choose repositories' });
  await dialog.getByLabel('Owner / organization / group').fill('example');
  await dialog.getByRole('button', { name: 'Load', exact: true }).click();
  await expect(dialog.locator('tbody tr')).toHaveCount(50);
  await dialog.getByRole('button', { name: 'Select all missing', exact: true }).click();
  await expect(dialog.locator('#browser-selected')).toContainText('50 selected');
  await dialog.getByLabel('Shared destination', { exact: true }).fill(root);
  await dialog.getByRole('button', { name: 'Add 50 sources', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const saved = (await a.page.evaluate(() => window.gitCloner.getState())).config.sources;
  expect(saved).toHaveLength(51);
  expect(saved.filter(source => source.value === 'example/project-1')).toHaveLength(1);
  expect(saved.at(-1).value).toBe('example/project-51');
});
test('downloaded release files have a visible path and the folder action opens that exact directory', async () => {
  const callbacks = [],
    f = await repository({ after: callback => callbacks.push(callback) });
  cleanup.push(async () => {
    for (const callback of callbacks) await callback();
  });
  f.releases = [
    { tag_name: 'v1.0.0', assets: [f.asset(7, 'program-macos-universal.dmg', 'actual fixture disk image')] }
  ];
  f.options.metadata.releases = true;
  const record = await f.sync(),
    a = await app({ config: f.config(), state: { repositories: { [record.id]: record } } });
  await expect(a.page.locator('.release-location')).toHaveText('Git-Cloner-Releases/');
  await expect(a.page.locator('#repository-list')).toContainText('1 release assets');
  await a.application.evaluate(({ shell }) => {
    shell.openPath = async value => {
      globalThis.openedReleasePath = value;
      return '';
    };
  });
  await a.page.getByRole('button', { name: 'Open release folder', exact: true }).click();
  await expect
    .poll(() => a.application.evaluate(() => globalThis.openedReleasePath))
    .toBe(path.join(record.destination, 'Git-Cloner-Releases'));
  expect(
    await fs.readFile(path.join(record.destination, 'Git-Cloner-Releases', 'program-macos-universal.dmg'), 'utf8')
  ).toBe('actual fixture disk image');
  await capture(a.page, 'release-location.png');
});

test('an open source dialog receives newly saved accounts without losing typed input', async () => {
  const config = defaults();
  config.checkUpdates = false;
  const a = await app({ config });
  await a.application.evaluate(({ app }) => {
    const fs = process.getBuiltinModule('node:fs/promises'),
      original = fs.rename,
      settings = app.getPath('userData') + '/settings.json';
    fs.rename = async (from, to) => {
      if (to.replaceAll('\\', '/') === settings.replaceAll('\\', '/')) {
        globalThis.accountSavePending = true;
        await new Promise(resolve => {
          globalThis.releaseAccountSave = resolve;
        });
      }
      return original(from, to);
    };
    globalThis.finishAccountSave = () => {
      fs.rename = original;
      globalThis.releaseAccountSave?.();
    };
  });
  await a.page.getByRole('button', { name: 'Settings', exact: true }).click();
  await a.page.getByRole('tab', { name: 'Accounts', exact: true }).click();
  await a.page.getByLabel('GitHub account label').fill('Example account');
  await a.page.getByRole('button', { name: 'Add account', exact: true }).click();
  await expect.poll(() => a.application.evaluate(() => globalThis.accountSavePending)).toBe(true);
  await sources(a.page);
  await a.page.getByRole('button', { name: 'Add source', exact: true }).click();
  const dialog = a.page.getByRole('dialog', { name: 'Add source' });
  await dialog.locator('#source-values').fill('example/project');
  await expect(dialog.locator('#source-account option').filter({ hasText: 'Example account' })).toHaveCount(0);
  await a.application.evaluate(() => globalThis.finishAccountSave());
  await expect(dialog.locator('#source-account option').filter({ hasText: 'Example account' })).toHaveCount(1);
  await expect(dialog.locator('#source-values')).toHaveValue('example/project');
  await expect(dialog.locator('#source-values')).toBeFocused();
  await dialog.getByText('Additional destinations, account and filters', { exact: true }).click();
  await dialog.locator('#source-account').selectOption({ label: 'Example account' });
  expect(await dialog.locator('#source-account').inputValue()).not.toBe('default');
});
