const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execute = promisify(execFile);
const { launch, screenshotPath } = require('./helpers.cjs');
const { defaults } = require('../../app/core/config.cjs');
const { prepareDestination } = require('../../app/core/destinations.cjs');
const { Git } = require('../../app/core/git.cjs');
const { syncRepository } = require('../../app/core/backup.cjs');
const repositories = names =>
  names.map(name => ({
    full_name: name,
    owner: { login: name.split('/')[0] },
    size: 1,
    has_wiki: false,
    default_branch: 'main'
  }));
async function capture(page, name) {
  await page.screenshot({ path: screenshotPath(name), fullPage: !(await page.locator('dialog[open]').count()) });
}
const temporaryRoots = [];
test.afterEach(async () => {
  for (const root of temporaryRoots.splice(0))
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});
async function local() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gc-flow-ui-'));
  temporaryRoots.push(root);
  const remote = path.join(root, 'remote'),
    backup = path.join(root, 'backup'),
    restore = path.join(root, 'restore');
  await Promise.all([fs.mkdir(remote), fs.mkdir(backup), fs.mkdir(restore)]);
  const git = (...args) => execute('git', args, { cwd: remote, windowsHide: true });
  await git('init', '-b', 'main');
  await git('config', 'user.name', 'UI tests');
  await git('config', 'user.email', 'tests@example.invalid');
  await fs.mkdir(path.join(remote, 'src'));
  await fs.writeFile(path.join(remote, 'src', 'one.txt'), 'one');
  await fs.writeFile(path.join(remote, 'README.md'), 'read me');
  await git('add', '.');
  await git('commit', '-m', 'initial');
  return { root, remote, backup, restore };
}

test('first-run wizard has no prefilled source, previews read-only and saves three aligned check times', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gc-wizard-ui-')),
    f = await launch({ repositories: repositories(['beispiel-konto/app']) });
  try {
    await f.page.getByRole('button', { name: 'Start setup', exact: true }).click();
    await expect(f.page.getByLabel('Your GitHub sources')).toHaveValue('');
    await f.page.getByLabel('Your GitHub sources').fill('beispiel-konto');
    await f.page.getByRole('button', { name: 'Next', exact: true }).click();
    await f.page.getByLabel('Backup folder', { exact: true }).fill(root);
    await f.page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(f.page.getByRole('dialog')).toContainText('beispiel-konto/app');
    expect(await fs.readdir(root)).toEqual([]);
    await f.page.getByLabel('Checks per day', { exact: true }).selectOption('3');
    const times = f.page.locator('[data-wizard-time]');
    await expect(times).toHaveCount(3);
    await times.nth(0).fill('01:00');
    await times.nth(1).fill('09:00');
    await times.nth(2).fill('17:00');
    const boxes = await Promise.all([times.nth(0).boundingBox(), times.nth(1).boundingBox()]);
    expect(Math.abs(boxes[0].y - boxes[1].y)).toBeLessThan(1);
    expect(Math.abs(boxes[0].height - boxes[1].height)).toBeLessThan(1);
    await capture(f.page, 'setup-wizard.png');
    await f.page.getByRole('button', { name: 'Save setup' }).click();
    await expect(f.page.getByRole('dialog')).not.toBeVisible();
    const state = await f.page.evaluate(() => window.gitCloner.getState());
    expect(state.config.setupCompleted).toBe(true);
    expect(state.config.sources[0].value).toBe('beispiel-konto');
    expect(state.config.schedule.times).toEqual(['01:00', '09:00', '17:00']);
    expect(state.config.sources[0].volumeId).toBeTruthy();
    expect(await fs.readdir(root)).toEqual(['.git-cloner-volume.json']);
  } finally {
    await f.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
test('dry-run exposes filtered repositories and planned locations without creating a backup root', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gc-preview-ui-')),
    config = defaults();
  config.sources = [
    {
      id: 'source',
      kind: 'owner',
      value: 'demo',
      enabled: true,
      destination: root,
      filters: { includeForks: true, includeArchived: true, include: [], exclude: ['*-old'] }
    }
  ];
  const f = await launch({ config, repositories: repositories(['demo/current', 'demo/project-old']) });
  try {
    await f.page.getByRole('button', { name: 'Dry run', exact: true }).click();
    await expect(f.page.getByRole('dialog')).toContainText(path.join(root, 'demo', 'current'));
    await expect(f.page.getByRole('dialog')).toContainText('Excluded');
    await f.page.getByText('Excluded entries (1)').click();
    await expect(f.page.getByRole('dialog')).toContainText('demo/project-old');
    expect(await fs.readdir(root)).toEqual([]);
    await capture(f.page, 'dry-run.png');
  } finally {
    await f.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
test('source-specific mirror, metadata and LFS options persist without changing the global backup mode', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gc-source-options-ui-')),
    f = await launch();
  try {
    await f.page.getByRole('button', { name: 'Sources', exact: true }).click();
    await f.page.getByRole('button', { name: 'Add source', exact: true }).first().click();
    await f.page.getByLabel('GitHub account or repository').fill('demo/project');
    await f.page.getByLabel('Destination folder on your drive').fill(root);
    await f.page.getByText('Backup content for this source', { exact: true }).click();
    await f.page.getByLabel('Use source-specific backup options').check();
    await f.page.getByLabel('Git mode for this source').selectOption('mirror');
    await expect(f.page.getByRole('checkbox', { name: 'Submodules', exact: true })).toBeDisabled();
    await f.page.getByRole('checkbox', { name: 'Git LFS', exact: true }).check();
    await f.page.getByRole('checkbox', { name: 'Issues', exact: true }).check();
    await f.page.getByRole('dialog').getByRole('button', { name: 'Add source', exact: true }).click();
    await expect(f.page.getByRole('dialog')).not.toBeVisible();
    const state = await f.page.evaluate(() => window.gitCloner.getState());
    expect(state.config.sources[0].backup).toMatchObject({ mode: 'mirror', lfs: true, metadata: { issues: true } });
    expect(state.config.backup.mode).toBe('snapshot');
  } finally {
    await f.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
test('performance and resource rules save with aligned fields and persistent values', async () => {
  const f = await launch();
  try {
    await f.page.getByRole('button', { name: 'Settings', exact: true }).click();
    await f.page.getByRole('tab', { name: 'Performance & rules' }).click();
    await f.page.getByLabel('Concurrent small repositories').fill('3');
    await f.page.getByLabel('Small repository threshold (MiB)').fill('64');
    await f.page.getByLabel('Retries for network failures').fill('3');
    await f.page.getByLabel('Download limit (KiB/s)').fill('256');
    await f.page.getByRole('checkbox', { name: 'Back up on AC power only' }).check();
    await f.page.getByLabel('Allowed Wi-Fi names').fill('Office\nHome');
    const boxes = await Promise.all(
      ['Concurrent small repositories', 'Small repository threshold (MiB)'].map(label =>
        f.page.getByLabel(label).boundingBox()
      )
    );
    expect(Math.abs(boxes[0].y - boxes[1].y)).toBeLessThan(1);
    expect(boxes[0].height).toBe(boxes[1].height);
    await capture(f.page, 'performance-settings.png');
    await f.page.getByRole('button', { name: 'Save settings' }).click();
    await expect(f.page.locator('#toast')).toHaveText(/^(Einstellungen gespeichert\.|Settings saved\.)$/);
    await f.page.reload();
    await f.page.getByRole('button', { name: 'Settings', exact: true }).click();
    await f.page.getByRole('tab', { name: 'Performance & rules' }).click();
    await expect(f.page.getByLabel('Download limit (KiB/s)')).toHaveValue('256');
    const state = await f.page.evaluate(() => window.gitCloner.getState());
    expect(state.config.execution).toMatchObject({
      concurrency: 3,
      retries: 3,
      bandwidthKBps: 256,
      onlyOnAC: true,
      allowedNetworks: ['Office', 'Home']
    });
  } finally {
    await f.close();
  }
});
test('high contrast persists, tabs support arrow keys and shortcuts open accessible dialogs', async () => {
  const config = defaults();
  config.appearance.theme = 'light';
  const f = await launch({ config });
  try {
    await f.page.keyboard.press('ControlOrMeta+,');
    await f.page.getByRole('tab', { name: 'Appearance', exact: true }).click();
    await f.page.getByRole('tab', { name: 'Appearance', exact: true }).press('ArrowRight');
    await expect(f.page.getByRole('tab', { name: 'Performance & rules' })).toBeFocused();
    await f.page.getByRole('tab', { name: 'Performance & rules' }).press('Home');
    await expect(f.page.getByRole('tab', { name: 'General', exact: true })).toBeFocused();
    await f.page.getByRole('tab', { name: 'Appearance', exact: true }).click();
    await f.page.getByRole('checkbox', { name: 'Enable high contrast' }).check();
    await f.page.getByRole('button', { name: 'Save settings' }).click();
    await expect(f.page.locator('#toast')).toHaveText(/^(Einstellungen gespeichert\.|Settings saved\.)$/);
    await expect(f.page.locator('html')).toHaveAttribute('data-contrast', 'high');
    const ratio = await f.page.evaluate(() => {
      const node = document.querySelector('.field-help'),
        background = document.querySelector('.panel'),
        rgb = s => s.match(/\d+/g).slice(0, 3).map(Number),
        lum = c =>
          c
            .map(v => {
              v /= 255;
              return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
            })
            .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0),
        a = lum(rgb(getComputedStyle(node).color)),
        b = lum(rgb(getComputedStyle(background).backgroundColor));
      return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    });
    expect(ratio).toBeGreaterThanOrEqual(4.5);
    await capture(f.page, 'high-contrast.png');
    await f.page.reload();
    await expect(f.page.locator('html')).toHaveAttribute('data-contrast', 'high');
    await f.page.keyboard.press('F1');
    await expect(f.page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
    await f.page.keyboard.press('Escape');
    await f.page.keyboard.press('ControlOrMeta+n');
    await expect(f.page.getByRole('dialog', { name: 'Add source' })).toBeVisible();
    await f.page.keyboard.press('Escape');
  } finally {
    await f.close();
  }
});
test('skip link focuses the main content and preserves application access', async () => {
  const f = await launch();
  try {
    await f.page.locator('.skip-link').focus();
    await f.page.locator('.skip-link').press('Enter');
    await expect(f.page.locator('#main-content')).toBeFocused();
    expect(new URL(f.page.url()).hash).toBe('');
    const state = await f.page.evaluate(() => window.gitCloner.getState());
    expect(state.config.sources).toEqual([]);
    await f.page.getByRole('button', { name: 'Settings', exact: true }).click();
    await f.page.getByRole('button', { name: 'Save settings' }).click();
    await expect(f.page.locator('#toast')).toHaveText(/^(Einstellungen gespeichert\.|Settings saved\.)$/);
    await expect(f.page.locator('#main-content')).toContainText('Essential settings first');
  } finally {
    await f.close();
  }
});
test('GUI pause survives restart and resume does not rewrite completed repositories', async () => {
  const f = await local(),
    source = await prepareDestination({
      id: 'source-0',
      kind: 'repository',
      value: 'demo/repo-0',
      destination: f.backup,
      enabled: true
    }),
    config = defaults(),
    names = ['demo/repo-0', 'demo/repo-1', 'demo/repo-2'];
  config.execution.concurrency = 1;
  config.schedule.enabled = false;
  config.checkUpdates = false;
  config.sources = names.map((value, i) => ({ ...source, id: `source-${i}`, value }));
  const remotes = Object.fromEntries(
    names.map(name => [`https://github.com/${name}.git`, pathToFileURL(f.remote).href])
  );
  let app = await launch({ config, repositories: repositories(names), remotes });
  try {
    await app.page.getByRole('button', { name: 'Check now', exact: true }).click();
    await expect(app.page.locator('#backup-progress')).toContainText('demo/repo-0');
    await app.page.getByRole('button', { name: 'Pause after active repos' }).click();
    await expect(app.page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
    const state = await app.page.evaluate(() => window.gitCloner.getState());
    expect(state.queue.completed).toBe(1);
    const finished = path.join(f.backup, 'demo', 'repo-0'),
      stamp = (await fs.stat(finished)).mtimeMs,
      directory = app.directory;
    await app.close({ preserve: true });
    app = await launch({ directory, repositories: repositories(names), remotes });
    await expect(app.page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
    await capture(app.page, 'paused-queue.png');
    await app.page.getByRole('button', { name: 'Resume', exact: true }).click();
    await expect.poll(async () => (await app.page.evaluate(() => window.gitCloner.getState())).queue).toBeNull();
    const result = await app.page.evaluate(() => window.gitCloner.getState());
    expect(result.history[0]).toMatchObject({ resultCount: 3, errorCount: 0 });
    expect((await fs.stat(finished)).mtimeMs).toBe(stamp);
    expect(await fs.readFile(path.join(f.backup, 'demo', 'repo-2', 'README.md'), 'utf8')).toBe('read me');
    await expect(app.page.locator('#dashboard-metrics')).toContainText('Size of tracked backups');
    await app.page.locator('#dashboard-metrics').screenshot({ path: screenshotPath('dashboard.png') });
  } finally {
    await app.close();
  }
});
test('GUI selects a directory from an encrypted backup and restores only the selected files', async () => {
  const f = await local(),
    source = await prepareDestination({
      id: 'source',
      kind: 'repository',
      value: 'demo/project',
      destination: f.backup,
      enabled: true
    }),
    url = pathToFileURL(f.remote).href;
  class LocalGit extends Git {
    run(args, options) {
      return super.run(
        args.map(arg => (arg === 'https://github.com/demo/project.git' ? url : arg)),
        options
      );
    }
  }
  const record = await syncRepository({
      source,
      repository: { full_name: 'demo/project', size: 1 },
      git: new LocalGit(),
      options: { ...defaults().backup, encryption: true },
      passphrase: 'my long restore password'
    }),
    app = await launch({ state: { repositories: { project: record }, history: [] } });
  try {
    await app.page.getByRole('button', { name: 'Restore', exact: true }).click();
    await app.page.getByLabel('Saved backup').selectOption({ index: 1 });
    await app.page.getByLabel('Restore scope').selectOption('selection');
    await app.page.getByLabel('Archive password (encrypted backups only)').fill('my long restore password');
    await app.page.getByRole('button', { name: 'Choose files', exact: true }).click();
    await expect(app.page.getByRole('checkbox', { name: 'src select', exact: true })).toBeVisible();
    await app.page.getByRole('checkbox', { name: 'src select', exact: true }).check();
    await capture(app.page, 'selective-restore.png');
    await app.page.getByLabel('Parent folder').fill(f.restore);
    await app.page.getByLabel('New folder name').fill('selected');
    await app.page.getByRole('button', { name: 'Verify & restore' }).click();
    await expect(app.page.locator('#restore-result')).toContainText('Verified and restored successfully');
    expect(await fs.readdir(path.join(f.restore, 'selected'))).toEqual(['src']);
    expect(await fs.readFile(path.join(f.restore, 'selected', 'src', 'one.txt'), 'utf8')).toBe('one');
  } finally {
    await app.close();
  }
});
