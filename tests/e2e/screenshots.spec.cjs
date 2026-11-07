const { test } = require('@playwright/test');
const { launch, screenshotPath } = require('./helpers.cjs');
const { defaults } = require('../../app/core/config.cjs');

test('capture real application screenshots with empty first-run configuration', async () => {
  const config = defaults();
  config.checkUpdates = false;
  const f = await launch({ config });
  try {
    await f.application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 1040));
    await f.page.screenshot({ path: screenshotPath('overview.png') });
    await f.page.getByRole('button', { name: 'Sources', exact: true }).click();
    await f.page.getByRole('button', { name: 'Add source', exact: true }).first().click();
    await f.page.screenshot({ path: screenshotPath('add-source.png') });
    await f.page.getByRole('button', { name: 'Cancel' }).click();
    await f.page.getByRole('button', { name: 'Schedule', exact: true }).click();
    await f.page.getByLabel('Frequency').selectOption('3');
    await f.page.screenshot({ path: screenshotPath('schedule.png') });
    await f.page.getByRole('button', { name: 'Settings', exact: true }).click();
    await f.page.screenshot({ path: screenshotPath('settings.png') });
    await f.page.getByRole('tab', { name: 'Backup', exact: true }).click();
    await f.page.screenshot({ path: screenshotPath('backup-settings.png'), fullPage: true });
    await f.page.getByRole('button', { name: 'Restore', exact: true }).click();
    await f.page.screenshot({ path: screenshotPath('restore.png'), fullPage: true });
    await f.page.getByRole('button', { name: 'Sources', exact: true }).click();
    await f.page.getByRole('button', { name: 'Add source', exact: true }).first().click();
    await f.page.getByLabel('GitHub account or repository').fill('beispiel-konto');
    await f.page.getByLabel('Destination folder on your drive').fill('/Volumes/BackupDisk/GitHub');
    await f.page.getByText('Additional destinations, account and filters', { exact: true }).click();
    await f.page.getByRole('button', { name: 'Add another destination' }).click();
    await f.page.getByLabel('Additional destination 1').fill('/Volumes/SecondDisk/GitHub');
    await f.page.getByLabel('Include names (optional)').fill('projekt-*');
    await f.application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 1280));
    await f.page.screenshot({ path: screenshotPath('source-advanced.png') });
  } finally {
    await f.close();
  }
  const dark = await launch({ config: { ...config, appearance: { language: 'en', theme: 'dark', fontScale: 1.15 } } });
  try {
    await dark.application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 1040));
    await dark.page.screenshot({ path: screenshotPath('dark-english.png') });
  } finally {
    await dark.close();
  }
  // Explicit local fixture, not a claim that this release exists on GitHub.
  const update = await launch({
    config,
    release: 'v' + require('semver').inc(require('../../package.json').version, 'minor')
  });
  try {
    await update.application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1280, 1040));
    await update.page.evaluate(() => window.gitCloner.checkUpdates());
    await update.page.locator('#update-banner .update-banner').waitFor();
    await update.page.screenshot({ path: screenshotPath('update-notice.png') });
  } finally {
    await update.close();
  }
});
