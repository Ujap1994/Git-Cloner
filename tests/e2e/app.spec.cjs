const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { launch } = require('./helpers.cjs');

test('first launch has no default repositories and sandboxed renderer', async () => {
  const f = await launch();
  try {
    await expect(f.page.getByRole('heading', { name: 'Your code deserves a safe place.' })).toBeVisible();
    await expect(f.page.getByRole('button', { name: 'Check now', exact: true })).toBeDisabled();
    const state = await f.page.evaluate(() => window.gitCloner.getState());
    expect(state.config.sources).toEqual([]);
    expect(state.update.currentVersion).toBe(require('../../package.json').version);
    expect(await f.page.evaluate(() => typeof window.require)).toBe('undefined');
    const prefs = await f.application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences()
    );
    expect(prefs.contextIsolation).toBe(true);
    expect(prefs.sandbox).toBe(true);
    expect(prefs.nodeIntegration).toBe(false);
  } finally {
    await f.close();
  }
});
test('adds multiple repositories and accepts rapid toggle and remove without deleting files', async () => {
  const f = await launch();
  const destination = await fs.mkdtemp(path.join(os.tmpdir(), 'git-cloner-target-'));
  try {
    await f.page.getByRole('button', { name: 'Sources', exact: true }).click();
    await f.page.getByRole('button', { name: 'Add source', exact: true }).first().click();
    await f.page.getByLabel('GitHub account or repository').fill('some-user/repo-one\nother-user/repo-two');
    await f.page.getByLabel('Destination folder on your drive').fill(destination);
    await f.page.getByRole('dialog').getByRole('button', { name: 'Add source', exact: true }).click();
    await expect(f.page.getByRole('dialog')).not.toBeVisible();
    await expect(f.page.getByText('some-user/repo-one', { exact: true })).toBeVisible();
    await expect(f.page.getByText('other-user/repo-two', { exact: true })).toBeVisible();
    await fs.writeFile(path.join(destination, 'keep.txt'), 'personal');
    await f.page.evaluate(() => {
      document.querySelector('input[aria-label="some-user/repo-one enabled"]').click();
      document.querySelector('button[aria-label="some-user/repo-one remove"]').click();
    });
    await expect(f.page.getByText('some-user/repo-one', { exact: true })).toHaveCount(0);
    expect(await fs.readFile(path.join(destination, 'keep.txt'), 'utf8')).toBe('personal');
    const config = JSON.parse(await fs.readFile(path.join(f.directory, 'settings.json'), 'utf8'));
    expect(config.sources).toHaveLength(1);
    expect(config.sources[0].volumeId).toBeTruthy();
    expect(config.sources[0].value).toBe('other-user/repo-two');
    expect(config.sources[0].enabled).toBe(true);
    await f.page.reload();
    await f.page.getByRole('button', { name: 'Sources', exact: true }).click();
    await expect(f.page.getByText('some-user/repo-one', { exact: true })).toHaveCount(0);
    await expect(f.page.getByText('other-user/repo-two', { exact: true })).toBeVisible();
  } finally {
    await f.close();
    await fs.rm(destination, { recursive: true, force: true });
  }
});
test('schedule supports multiple times and persists to disk', async () => {
  const f = await launch();
  try {
    await f.page.getByRole('button', { name: 'Schedule', exact: true }).click();
    await f.page.getByLabel('Frequency').selectOption('3');
    const frequency = await f.page.getByLabel('Frequency').boundingBox();
    for (const name of ['Check 01', 'Check 02', 'Check 03']) {
      const field = await f.page.getByLabel(name).boundingBox();
      expect(Math.abs(field.y - frequency.y)).toBeLessThan(1);
      expect(Math.abs(field.height - frequency.height)).toBeLessThan(1);
    }
    await f.page.getByLabel('Check 01').fill('01:15');
    await f.page.getByLabel('Check 02').fill('09:30');
    await f.page.getByLabel('Check 03').fill('19:45');
    await f.page.getByRole('button', { name: 'Save schedule' }).click();
    await expect(f.page.locator('#toast')).toContainText('saved');
    expect(JSON.parse(await fs.readFile(path.join(f.directory, 'settings.json'), 'utf8')).schedule.times).toEqual([
      '01:15',
      '09:30',
      '19:45'
    ]);
    await f.page.reload();
    await f.page.getByRole('button', { name: 'Schedule', exact: true }).click();
    await expect(f.page.getByLabel('Frequency')).toHaveValue('3');
    await expect(f.page.getByLabel('Check 03')).toHaveValue('19:45');
  } finally {
    await f.close();
  }
});
test('invalid sources and duplicate times show errors without saving', async () => {
  const f = await launch();
  try {
    await f.page.getByRole('button', { name: 'Add source', exact: true }).first().click();
    await f.page.getByLabel('GitHub account or repository').fill('https://evil.test/a/b');
    await f.page.getByLabel('Destination folder on your drive').fill(os.tmpdir());
    await f.page.getByRole('dialog').getByRole('button', { name: 'Add source', exact: true }).click();
    await expect(f.page.getByRole('alert')).toContainText('GitHub');
    await f.page.getByRole('button', { name: 'Cancel' }).click();
    await f.page.getByRole('button', { name: 'Schedule', exact: true }).click();
    await f.page.getByLabel('Frequency').selectOption('2');
    await f.page.getByLabel('Check 02').fill('02:00');
    await f.page.getByRole('button', { name: 'Save schedule' }).click();
    await expect(f.page.locator('#toast')).toContainText('separate');
    const state = await f.page.evaluate(() => window.gitCloner.getState());
    expect(state.config.schedule.checksPerDay).toBe(1);
  } finally {
    await f.close();
  }
});
test('settings and built-in documentation are available', async () => {
  const f = await launch();
  try {
    await f.page.getByRole('button', { name: 'Settings', exact: true }).click();
    await expect(f.page.getByRole('heading', { name: 'Version & updates' })).toBeVisible();
    await f.page.getByRole('checkbox', { name: 'Enable notifications' }).uncheck();
    await f.page.getByRole('button', { name: 'Save settings' }).click();
    await expect(f.page.locator('#toast')).toHaveText(/^(Einstellungen gespeichert\.|Settings saved\.)$/);
    await expect(f.page.getByRole('checkbox', { name: 'Enable notifications' })).not.toBeChecked();
    await f.page.getByRole('button', { name: 'Documentation', exact: true }).click();
    await expect(f.page.getByRole('heading', { name: 'Your first backup in three steps' })).toBeVisible();
    await expect(f.page.getByRole('heading', { name: 'What is backed up?' })).toBeVisible();
  } finally {
    await f.close();
  }
});
