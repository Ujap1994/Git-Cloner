const { test,expect } = require('@playwright/test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { launch } = require('./helpers.cjs');

test('first launch has no default repositories and sandboxed renderer',async()=>{
  const f=await launch();
  try {
    await expect(f.page.getByRole('heading',{name:'Dein Code verdient einen sicheren Platz.'})).toBeVisible();
    await expect(f.page.getByRole('button',{name:'Jetzt prüfen',exact:true})).toBeDisabled();
    const state=await f.page.evaluate(()=>window.gitCloner.getState());expect(state.config.sources).toEqual([]);
    expect(state.update.currentVersion).toBe(require('../../package.json').version);
    expect(await f.page.evaluate(()=>typeof window.require)).toBe('undefined');
    const prefs=await f.application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences());
    expect(prefs.contextIsolation).toBe(true);expect(prefs.sandbox).toBe(true);expect(prefs.nodeIntegration).toBe(false);
  } finally {await f.close();}
});
test('adds multiple repositories, edits the path, toggles and removes without deleting files',async()=>{
  const f=await launch();
  const destination=await fs.mkdtemp(path.join(os.tmpdir(),'git-cloner-target-'));
  try {
    await f.page.getByRole('button',{name:'Quellen',exact:true}).click();
    await f.page.getByRole('button',{name:'Quelle hinzufügen',exact:true}).first().click();
    await f.page.getByLabel('GitHub-Konto oder Repository').fill('some-user/repo-one\nother-user/repo-two');
    await f.page.getByLabel('Zielordner auf deinem Laufwerk').fill(destination);
    await f.page.getByRole('dialog').getByRole('button',{name:'Quelle hinzufügen',exact:true}).click();
    await expect(f.page.getByRole('dialog')).not.toBeVisible();
    await expect(f.page.getByText('some-user/repo-one',{exact:true})).toBeVisible();
    await expect(f.page.getByText('other-user/repo-two',{exact:true})).toBeVisible();
    await f.page.getByRole('checkbox',{name:'some-user/repo-one aktivieren'}).uncheck();
    await expect(f.page.getByRole('checkbox',{name:'some-user/repo-one aktivieren'})).not.toBeChecked();
    await fs.writeFile(path.join(destination,'keep.txt'),'personal');
    await f.page.getByRole('button',{name:'some-user/repo-one entfernen'}).click();
    await expect(f.page.getByText('some-user/repo-one',{exact:true})).toHaveCount(0);
    expect(await fs.readFile(path.join(destination,'keep.txt'),'utf8')).toBe('personal');
    const config=JSON.parse(await fs.readFile(path.join(f.directory,'settings.json'),'utf8'));
    expect(config.sources).toHaveLength(1);expect(config.sources[0].volumeId).toBeTruthy();
  } finally {await f.close();await fs.rm(destination,{recursive:true,force:true});}
});
test('schedule supports multiple times and persists to disk',async()=>{
  const f=await launch();
  try {
    await f.page.getByRole('button',{name:'Zeitplan',exact:true}).click();
    await f.page.getByLabel('Häufigkeit').selectOption('3');
    const frequency = await f.page.getByLabel('Häufigkeit').boundingBox();
    for (const name of ['Prüfung 01','Prüfung 02','Prüfung 03']) {
      const field = await f.page.getByLabel(name).boundingBox();
      expect(Math.abs(field.y-frequency.y)).toBeLessThan(1);
      expect(Math.abs(field.height-frequency.height)).toBeLessThan(1);
    }
    await f.page.getByLabel('Prüfung 01').fill('01:15');
    await f.page.getByLabel('Prüfung 02').fill('09:30');
    await f.page.getByLabel('Prüfung 03').fill('19:45');
    await f.page.getByRole('button',{name:'Zeitplan speichern'}).click();
    await expect(f.page.locator('#toast')).toContainText('gespeichert');
    expect(JSON.parse(await fs.readFile(path.join(f.directory,'settings.json'),'utf8')).schedule.times).toEqual(['01:15','09:30','19:45']);
    await f.page.reload();
    await f.page.getByRole('button',{name:'Zeitplan',exact:true}).click();
    await expect(f.page.getByLabel('Häufigkeit')).toHaveValue('3');
    await expect(f.page.getByLabel('Prüfung 03')).toHaveValue('19:45');
  } finally {await f.close();}
});
test('invalid sources and duplicate times show errors without saving',async()=>{
  const f=await launch();
  try {
    await f.page.getByRole('button',{name:'Quelle hinzufügen',exact:true}).first().click();
    await f.page.getByLabel('GitHub-Konto oder Repository').fill('https://evil.test/a/b');
    await f.page.getByLabel('Zielordner auf deinem Laufwerk').fill(os.tmpdir());
    await f.page.getByRole('dialog').getByRole('button',{name:'Quelle hinzufügen',exact:true}).click();
    await expect(f.page.getByRole('alert')).toContainText('GitHub');
    await f.page.getByRole('button',{name:'Abbrechen'}).click();
    await f.page.getByRole('button',{name:'Zeitplan',exact:true}).click();
    await f.page.getByLabel('Häufigkeit').selectOption('2');
    await f.page.getByLabel('Prüfung 02').fill('02:00');
    await f.page.getByRole('button',{name:'Zeitplan speichern'}).click();
    await expect(f.page.locator('#toast')).toContainText('eigene');
    const state=await f.page.evaluate(()=>window.gitCloner.getState());
    expect(state.config.schedule.checksPerDay).toBe(1);
  } finally {await f.close();}
});
test('settings and built-in documentation are available',async()=>{
  const f=await launch();
  try {
    await f.page.getByRole('button',{name:'Einstellungen',exact:true}).click();
    await expect(f.page.getByRole('heading',{name:'Version & Updates'})).toBeVisible();
    await f.page.getByRole('checkbox',{name:'Benachrichtigungen aktivieren'}).uncheck();
    await f.page.getByRole('button',{name:'Einstellungen speichern'}).click();
    await expect(f.page.getByRole('checkbox',{name:'Benachrichtigungen aktivieren'})).not.toBeChecked();
    await f.page.getByRole('button',{name:'Dokumentation',exact:true}).click();
    await expect(f.page.getByRole('heading',{name:'In drei Schritten zur Sicherung'})).toBeVisible();
    await expect(f.page.getByRole('heading',{name:'Was wird gespeichert?'})).toBeVisible();
  } finally {await f.close();}
});
