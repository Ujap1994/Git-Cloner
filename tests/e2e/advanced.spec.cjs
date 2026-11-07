const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { launch, screenshotPath } = require('./helpers.cjs');
const { defaults } = require('../../app/core/config.cjs');
const { Git } = require('../../app/core/git.cjs');
const { prepareDestination } = require('../../app/core/destinations.cjs');
const { syncRepository } = require('../../app/core/backup.cjs');
const execute = promisify(execFile);
// Simulated releases are always newer than the version under test.
const NEXT = require('semver').inc(require('../../package.json').version, 'minor'),
  LATER = require('semver').inc(NEXT, 'minor');

test('ignored releases stay hidden after restart and the next release shows a new banner', async () => {
  let f = await launch({ release: 'v' + NEXT });
  try {
    await f.page.evaluate(() => window.gitCloner.checkUpdates());
    await expect(f.page.locator('#update-banner')).toContainText(NEXT);
    await f.page.locator('#update-banner').getByRole('button', { name: 'Skip this version' }).click();
    await expect(f.page.locator('#update-banner')).toBeEmpty();
    const directory = f.directory;
    await f.close({ preserve: true });
    f = await launch({ directory, release: 'v' + NEXT });
    await f.page.evaluate(() => window.gitCloner.checkUpdates());
    await expect(f.page.locator('#update-banner')).toBeEmpty();
    expect((await f.page.evaluate(() => window.gitCloner.getState())).update.status).toBe('ignored');
    await f.close({ preserve: true });
    f = await launch({ directory, release: 'v' + LATER });
    await f.page.evaluate(() => window.gitCloner.checkUpdates());
    await expect(f.page.locator('#update-banner')).toContainText(LATER);
  } finally {
    await f.close();
  }
});
test('a skipped release can be explicitly shown again', async () => {
  const f = await launch({ release: 'v' + NEXT });
  try {
    await f.page.evaluate(() => window.gitCloner.checkUpdates());
    await f.page.locator('#update-banner').getByRole('button', { name: 'Skip this version' }).click();
    await f.page.getByRole('button', { name: 'Settings', exact: true }).click();
    await f.page.getByRole('button', { name: 'Reset skipped version' }).click();
    await expect(f.page.locator('#update-banner')).toContainText(NEXT);
  } finally {
    await f.close();
  }
});
test('English, dark mode and large text persist with aligned controls and no horizontal overflow', async () => {
  const f = await launch();
  try {
    await f.page.getByRole('button', { name: 'Settings', exact: true }).click();
    await f.page.getByRole('tab', { name: 'Appearance', exact: true }).click();
    await f.page.getByLabel('Language', { exact: true }).selectOption('en');
    await f.page.getByRole('combobox', { name: 'Theme', exact: true }).selectOption('dark');
    await f.page.getByLabel('Text size').selectOption('1.3');
    await f.page.getByRole('button', { name: 'Save settings' }).click();
    await expect(f.page.locator('#toast')).toHaveText(/^(Einstellungen gespeichert\.|Settings saved\.)$/);
    await expect(f.page.getByRole('tab', { name: 'Appearance', exact: true })).toBeVisible();
    await expect(f.page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(f.page.locator('html')).toHaveAttribute('lang', 'en');
    const boxes = await Promise.all(
      ['Language', 'Theme', 'Text size'].map(label => f.page.getByLabel(label, { exact: true }).boundingBox())
    );
    for (const box of boxes) {
      expect(Math.abs(box.y - boxes[0].y)).toBeLessThan(1);
      expect(Math.abs(box.height - boxes[0].height)).toBeLessThan(1);
    }
    await f.application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1040, 900));
    expect(
      await f.page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)
    ).toBe(true);
    await f.page.reload();
    await f.page.getByRole('button', { name: 'Settings', exact: true }).click();
    await f.page.getByRole('tab', { name: 'Appearance', exact: true }).click();
    await expect(f.page.getByLabel('Text size')).toHaveValue('1.3');
  } finally {
    await f.close();
  }
});
test('source editor saves additional targets, filters and an independently selected account', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gc-source-ui-'));
  const one = path.join(root, 'one'),
    two = path.join(root, 'two');
  await fs.mkdir(one);
  await fs.mkdir(two);
  const f = await launch();
  try {
    await f.page.getByRole('button', { name: 'Settings', exact: true }).click();
    await f.page.getByRole('tab', { name: 'Accounts', exact: true }).click();
    await f.page.getByLabel('GitHub account label').fill('Account A');
    await f.page.getByRole('button', { name: 'Add account', exact: true }).click();
    await f.page.getByRole('button', { name: 'Sources', exact: true }).click();
    await f.page.getByRole('button', { name: 'Add source', exact: true }).first().click();
    await f.page.getByLabel('GitHub account or repository').fill('neutral-owner');
    await f.page.getByLabel('Destination folder on your drive').fill(one);
    await f.page.getByText('Additional destinations, account and filters', { exact: true }).click();
    await f.page.getByRole('button', { name: 'Add another destination' }).click();
    await f.page.getByLabel('Additional destination 1').fill(two);
    await f.page.getByLabel('Use credentials').selectOption({ label: 'Account A' });
    await f.page.getByLabel('Include forks').uncheck();
    await f.page.getByLabel('Include names (optional)').fill('app-*');
    await f.page.getByLabel('Exclude names').fill('*-test');
    await f.page.getByRole('dialog').getByRole('button', { name: 'Add source', exact: true }).click();
    await expect(f.page.getByRole('dialog')).not.toBeVisible();
    const state = await f.page.evaluate(() => window.gitCloner.getState());
    const source = state.config.sources[0];
    expect(source.additionalDestinations).toHaveLength(1);
    expect(source.additionalDestinations[0].volumeId).toBeTruthy();
    expect(source.filters.includeForks).toBe(false);
    expect(source.filters.exclude).toEqual(['*-test']);
    expect(source.accountId).toBe(state.config.accounts[0].id);
  } finally {
    await f.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
test('backup settings expose advanced options while keeping the landing page simple', async () => {
  const f = await launch();
  try {
    await f.page.getByRole('button', { name: 'Settings', exact: true }).click();
    await f.page.getByRole('tab', { name: 'Backup', exact: true }).click();
    await f.page.getByLabel('Git mode').selectOption('mirror');
    await expect(f.page.getByRole('checkbox', { name: 'Enable submodules' })).toBeDisabled();
    await f.page.getByRole('checkbox', { name: 'Enable Git LFS' }).check();
    await f.page.getByLabel('Automatic integrity checks').selectOption('manual');
    await f.page.getByRole('button', { name: 'Save settings' }).click();
    await expect(f.page.locator('#toast')).toHaveText(/^(Einstellungen gespeichert\.|Settings saved\.)$/);
    const state = await f.page.evaluate(() => window.gitCloner.getState());
    expect(state.config.backup.mode).toBe('mirror');
    expect(state.config.backup.lfs).toBe(true);
    expect(state.config.backup.integrity).toBe('manual');
    await f.page.getByRole('button', { name: 'Overview', exact: true }).click();
    await expect(f.page.getByRole('heading', { name: 'Everything in one safe place.' })).toBeVisible();
    await expect(f.page.getByLabel('Git mode')).toHaveCount(0);
  } finally {
    await f.close();
  }
});
test('restore assistant decrypts and verifies a real backup without a configured GitHub account', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gc-restore-ui-')),
    remote = path.join(root, 'remote'),
    backup = path.join(root, 'backup'),
    restored = path.join(root, 'restored');
  await Promise.all([fs.mkdir(remote), fs.mkdir(backup), fs.mkdir(restored)]);
  const gitCommand = (...args) => execute('git', args, { cwd: remote, windowsHide: true });
  await gitCommand('init', '-b', 'main');
  await gitCommand('config', 'user.name', 'UI tests');
  await gitCommand('config', 'user.email', 'tests@example.invalid');
  await fs.writeFile(path.join(remote, 'file.txt'), 'restore me');
  await gitCommand('add', '.');
  await gitCommand('commit', '-m', 'initial');
  const remoteUrl = pathToFileURL(remote).href;
  class LocalGit extends Git {
    run(args, options) {
      return super.run(
        args.map(arg => (arg === 'https://github.com/demo/project.git' ? remoteUrl : arg)),
        options
      );
    }
  }
  const source = await prepareDestination({
    id: 'source',
    kind: 'repository',
    value: 'demo/project',
    enabled: true,
    destination: backup
  });
  const options = { ...defaults().backup, encryption: true };
  const record = await syncRepository({
    source,
    repository: { full_name: 'demo/project', size: 1 },
    git: new LocalGit(),
    options,
    passphrase: 'my long restore passphrase'
  });
  const f = await launch({ state: { repositories: { project: record }, history: [] } });
  try {
    await f.page.getByRole('button', { name: 'Restore', exact: true }).click();
    await f.page.getByLabel('Saved backup').selectOption({ index: 1 });
    await f.page.getByLabel('Parent folder').fill(restored);
    await f.page.getByLabel('New folder name').fill('verified-copy');
    await f.page.getByLabel('Archive password (encrypted backups only)').fill('my long restore passphrase');
    await f.page.getByRole('button', { name: 'Verify & restore' }).click();
    await expect(f.page.locator('#restore-result')).toContainText('Verified and restored successfully');
    expect(await fs.readFile(path.join(restored, 'verified-copy', 'file.txt'), 'utf8')).toBe('restore me');
  } finally {
    await f.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
test('scheduled worker completes without opening a GUI when no source is due', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'gc-worker-ui-'));
  await fs.writeFile(screenshotPath('settings.json'), JSON.stringify(defaults()));
  try {
    // Match Playwright's Linux development launcher; shipped apps keep their sandbox.
    const flags = process.platform === 'linux' ? ['--no-sandbox'] : [];
    await execute(require('electron'), [...flags, path.resolve(__dirname, '../..'), '--scheduled-worker'], {
      env: { ...process.env, GIT_CLONER_E2E: '1', GIT_CLONER_TEST_DATA: directory },
      windowsHide: true,
      timeout: 30000
    });
    const logs = await fs.readFile(screenshotPath('worker.log'), 'utf8');
    expect(logs).toContain('not-due');
    expect(logs).not.toContain('password');
  } finally {
    await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});
test('progress notifications preserve repository rows, search focus and typed text', async () => {
  const record = {
    fullName: 'demo/project',
    destination: path.join(os.tmpdir(), 'neutral-backup'),
    status: 'unchanged',
    commit: 'a'.repeat(40),
    checkedAt: new Date().toISOString()
  };
  const f = await launch({ state: { repositories: { project: record }, history: [] } });
  try {
    const search = f.page.getByRole('searchbox');
    await search.fill('demo');
    await f.page.evaluate(() => {
      const search = document.querySelector('input[type="search"]'),
        row = document.querySelector('tbody tr');
      window.progressObserved = new Promise(resolve => {
        const stop = window.gitCloner.onState(state => {
          if (!state.busy || state.progress?.fullName !== 'demo/project') return;
          stop();
          resolve({
            text: document.querySelector('#backup-progress').textContent,
            sameSearch: search === document.querySelector('input[type="search"]'),
            sameRow: row === document.querySelector('tbody tr'),
            focused: document.activeElement === search,
            value: search.value
          });
        });
      });
    });
    await f.application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.send('state:changed', {
        busy: true,
        progress: { fullName: 'demo/project', status: 'verifying', completed: 1, total: 5 },
        dataRevision: 0
      })
    );
    const observed = await f.page.evaluate(() => window.progressObserved);
    expect(observed.text).toContain('demo/project');
    expect(observed).toMatchObject({ sameSearch: true, sameRow: true, focused: true, value: 'demo' });
  } finally {
    await f.close();
  }
});
