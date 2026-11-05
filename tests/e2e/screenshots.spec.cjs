const { test } = require('@playwright/test');
const fs = require('node:fs/promises');
const path = require('node:path');
const { launch } = require('./helpers.cjs');
const { defaults } = require('../../app/core/config.cjs');

test('capture real application screenshots with empty first-run configuration',async()=>{
  const config=defaults();config.checkUpdates=false;
  const f=await launch({config});
  const directory=path.resolve(__dirname,'../../docs/screenshots');
  await fs.mkdir(directory,{recursive:true});
  try {
    await f.application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1280,1040));
    await f.page.screenshot({path:path.join(directory,'overview.png')});
    await f.page.getByRole('button',{name:'Quellen',exact:true}).click();
    await f.page.getByRole('button',{name:'Quelle hinzufügen',exact:true}).first().click();
    await f.page.screenshot({path:path.join(directory,'add-source.png')});
    await f.page.getByRole('button',{name:'Abbrechen'}).click();
    await f.page.getByRole('button',{name:'Zeitplan',exact:true}).click();
    await f.page.getByLabel('Häufigkeit').selectOption('3');
    await f.page.screenshot({path:path.join(directory,'schedule.png')});
    await f.page.getByRole('button',{name:'Einstellungen',exact:true}).click();
    await f.page.screenshot({path:path.join(directory,'settings.png')});
    await f.page.getByRole('tab',{name:'Sicherung',exact:true}).click();
    await f.page.screenshot({path:path.join(directory,'backup-settings.png'),fullPage:true});
    await f.page.getByRole('button',{name:'Wiederherstellen',exact:true}).click();
    await f.page.screenshot({path:path.join(directory,'restore.png'),fullPage:true});
    await f.page.getByRole('button',{name:'Quellen',exact:true}).click();
    await f.page.getByRole('button',{name:'Quelle hinzufügen',exact:true}).first().click();
    await f.page.getByLabel('GitHub-Konto oder Repository').fill('beispiel-konto');
    await f.page.getByLabel('Zielordner auf deinem Laufwerk').fill('/Volumes/BackupDisk/GitHub');
    await f.page.getByText('Weitere Ziele, Konto und Filter',{exact:true}).click();
    await f.page.getByRole('button',{name:'Weiteren Zielordner hinzufügen'}).click();
    await f.page.getByLabel('Weiteres Ziel 1').fill('/Volumes/SecondDisk/GitHub');
    await f.page.getByLabel('Nur diese Namen (optional)').fill('projekt-*');
    await f.application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1280,1280));
    await f.page.screenshot({path:path.join(directory,'source-advanced.png')});
  } finally {await f.close();}
  const dark=await launch({config:{...config,appearance:{language:'en',theme:'dark',fontScale:1.15}}});
  try{
    await dark.application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1280,1040));
    await dark.page.screenshot({path:path.join(directory,'dark-english.png')});
  }finally{await dark.close();}
  // Explicit local fixture, not a claim that this release exists on GitHub.
  const update=await launch({config,release:'v3.6.0'});
  try{
    await update.application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1280,1040));
    await update.page.evaluate(()=>window.gitCloner.checkUpdates());
    await update.page.locator('#update-banner .update-banner').waitFor();
    await update.page.screenshot({path:path.join(directory,'update-notice.png')});
  }finally{await update.close();}
});
