const { test, expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { launch } = require('./helpers.cjs');
const { defaults } = require('../../app/core/config.cjs');

for (const language of ['de', 'en']) test(`DMG variant selection persists globally and per source in ${language}`, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'gc-dmg-ui-'));
  const config = defaults(); config.checkUpdates = false; config.appearance.language = language; config.appearance.theme = 'dark'; config.appearance.fontScale = 1.3;
  config.backup.metadata.releases = true;
  let a;
  try {
    a = await launch({ config });
    const page = a.page, label = language === 'de' ? 'macOS-DMG-Variante' : 'macOS DMG variant';
    await page.locator('#navigation [data-view="settings"]').click();
    await page.locator('[data-settings-tab="backup"]').click();
    await page.getByLabel(label, { exact: true }).selectOption('universal');
    await page.locator('#settings-form button[type="submit"]').click();
    await expect.poll(async () => (await page.evaluate(() => window.gitCloner.getState())).config.backup.releaseDmgVariant).toBe('universal');
    await page.reload();
    await page.locator('#navigation [data-view="settings"]').click(); await page.locator('[data-settings-tab="backup"]').click();
    await expect(page.getByLabel(label, { exact: true })).toHaveValue('universal');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    if (language === 'en') { await page.getByLabel(label, { exact: true }).scrollIntoViewIfNeeded(); await page.screenshot({ path: path.resolve(__dirname, '../../docs/screenshots/dmg-variants.png') }); }
    await page.locator('#navigation [data-view="sources"]').click(); await page.locator('[data-action="add-source"]').click();
    await page.locator('#source-values').fill('example-owner/example-app'); await page.locator('#source-destination').fill(root);
    await page.getByText(language === 'de' ? 'Sicherungsumfang dieser Quelle' : 'Backup content for this source', { exact: true }).click();
    await page.locator('#source-own-backup').check();
    await page.locator('#source-release-dmg-variant').selectOption('x64');
    await page.locator('#source-submit').click();
    await expect(page.locator('#source-dialog')).not.toBeVisible();
    const state = await page.evaluate(() => window.gitCloner.getState());
    expect(state.config.sources[0].backup.releaseDmgVariant).toBe('x64'); expect(state.config.backup.releaseDmgVariant).toBe('universal');
    await page.reload(); await page.locator('#navigation [data-view="sources"]').click(); await page.locator('[data-edit-source]').click();
    await expect(page.locator('#source-release-dmg-variant')).toHaveValue('x64');
  } finally { await a?.close(); await fs.rm(root, { recursive: true, force: true }); }
});
