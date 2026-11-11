const { test, expect } = require('@playwright/test');
const { launch, screenshotPath } = require('./helpers.cjs');
const { defaults } = require('../../app/core/config.cjs');

test('update policies, pause reminders and overnight bandwidth settings persist in the English UI', async () => {
  const config = defaults();
  config.checkUpdates = false;
  const a = await launch({ config });
  try {
    const page = a.page;
    await page.locator('#navigation [data-view="settings"]').click();
    await page.getByRole('tab', { name: 'Backup', exact: true }).click();
    for (const mode of ['next-check', 'manual', 'after-exit']) {
      await page.locator('#program-updates-mode').selectOption(mode);
      await page.locator('#settings-form button[type="submit"]').click();
      await expect
        .poll(async () => (await page.evaluate(() => window.gitCloner.getState())).config.programUpdates.mode)
        .toBe(mode);
    }
    await page.locator('#program-updates-mode').scrollIntoViewIfNeeded();
    await page.screenshot({ path: screenshotPath('program-updates.png') });
    await page.getByRole('tab', { name: 'Performance & rules' }).click();
    await page.getByLabel('Separate limit during a time window', { exact: true }).check();
    await page.locator('#bandwidth-from').fill('22:00');
    await page.locator('#bandwidth-to').fill('06:00');
    await page.locator('#bandwidth-window-kbps').fill('128');
    await page.locator('#pause-action').selectOption('remind');
    await page.locator('#pause-hours').selectOption('6');
    await page.locator('#settings-form button[type="submit"]').click();
    await expect
      .poll(async () => (await page.evaluate(() => window.gitCloner.getState())).config.execution.bandwidthWindow.kbps)
      .toBe(128);
    await page.reload();
    await page.locator('#navigation [data-view="settings"]').click();
    await page.getByRole('tab', { name: 'Performance & rules' }).click();
    await expect(page.locator('#bandwidth-from')).toHaveValue('22:00');
    await expect(page.locator('#bandwidth-to')).toHaveValue('06:00');
    await expect(page.locator('#pause-hours')).toHaveValue('6');
    await page.locator('#bandwidth-from').scrollIntoViewIfNeeded();
    await page.screenshot({ path: screenshotPath('bandwidth-window.png') });
    await page.locator('#pause-action').scrollIntoViewIfNeeded();
    await page.screenshot({ path: screenshotPath('pause-reminder.png') });
    await page.getByRole('tab', { name: 'Accounts', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'API quota' })).toBeVisible();
    await expect(page.getByText('Shown after the first check.', { exact: true })).toBeVisible();
    await page.screenshot({ path: screenshotPath('api-quota.png') });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)
    ).toBe(true);
  } finally {
    await a.close();
  }
});

test('rollback presents the previous version and canceling leaves the managed program unchanged', async () => {
  const config = defaults();
  config.checkUpdates = false;
  const record = {
    id: 'example',
    sourceId: 'example',
    fullName: 'example/editor',
    destination: '/Example/Backups/editor',
    mode: 'snapshot',
    status: 'unchanged',
    checkedAt: new Date().toISOString(),
    installation: { status: 'installed', tag: 'v2.0.0', previousTag: 'v1.9.0', destination: '/Example/Programs/editor' }
  };
  const a = await launch({ config, state: { repositories: { example: record } } });
  try {
    const button = a.page.getByRole('button', { name: 'Roll back to v1.9.0', exact: true });
    await expect(button).toBeVisible();
    await a.page.screenshot({ path: screenshotPath('program-rollback.png') });
    const dismissed = new Promise(resolve =>
      a.page.once('dialog', async dialog => {
        expect(dialog.message()).toContain('Restore the previous version v1.9.0?');
        await dialog.dismiss();
        resolve();
      })
    );
    await button.click();
    await dismissed;
    const state = await a.page.evaluate(() => window.gitCloner.getState());
    expect(state.repositories.find(item => item.id === 'example').installation.tag).toBe('v2.0.0');
  } finally {
    await a.close();
  }
});
