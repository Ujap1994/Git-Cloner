const { app, BrowserWindow, ipcMain, dialog, Tray, Menu, nativeImage, shell, Notification, safeStorage, powerMonitor, clipboard } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { pathToFileURL } = require('node:url');
const { Runtime } = require('./runtime.cjs');
const { setAutostart } = require('./core/autostart.cjs');
const { setNativeSchedule } = require('./core/native-schedule.cjs');
const { exportSettings, importSettings, redactLogs } = require('./core/transfer.cjs');
const { readJson, writeJson } = require('./core/store.cjs');
const { RELEASES_URL } = require('./core/updates.cjs');
const { registrationTimes } = require('./core/schedule.cjs');
if (process.platform === 'win32') app.setAppUserModelId('io.github.Ujap1994.GitCloner');

const testMode = !app.isPackaged && process.env.GIT_CLONER_E2E === '1';
if (testMode && process.env.GIT_CLONER_TEST_DATA) app.setPath('userData', process.env.GIT_CLONER_TEST_DATA);
const worker = process.argv.includes('--scheduled-worker');
if (worker) app.disableHardwareAcceleration();
let locale = 'de';
try { const saved = JSON.parse(require('node:fs').readFileSync(path.join(app.getPath('userData'), 'settings.json'), 'utf8')); if (saved.appearance?.language === 'en') locale = 'en'; } catch (_error) { /* New profiles default to German. */ }
app.commandLine.appendSwitch('lang', locale);
const indexFile = path.join(__dirname, 'renderer', 'index.html'), indexUrl = pathToFileURL(indexFile).href;
let runtime, mainWindow, tray, quitting = false, broadcastTimer, lastData = -1, lastConfig = -1, lastHistory = '', pendingWorker = false;
const selectedArchives = new Set();
const pendingNotifications = new Set();
const text = (de, en) => runtime?.config.appearance.language === 'en' ? en : de;

if (!app.requestSingleInstanceLock({ worker })) app.quit();
else {
  app.on('second-instance', (_event, args, _cwd, data) => {
    if (data?.worker || args.includes('--scheduled-worker')) {
      if (runtime) void runtime.scheduledRun().catch(error => { runtime.notice = error.message; broadcast(); });
      else pendingWorker = true;
    } else showWindow();
  });
  app.whenReady().then(start).catch(async error => {
    if (worker) { await workerLog({ event: 'failed' }); app.exit(1); }
    else { dialog.showErrorBox('Git Cloner', error.message); app.exit(1); }
  });
}
function showWindow() { if (mainWindow && !mainWindow.isDestroyed()) { mainWindow.show(); mainWindow.focus(); } }
function state() { return { ...runtime.snapshot(), platform: process.platform, arch: process.arch, desktopDirectory: app.getPath('desktop'), packaged: app.isPackaged, nativeScheduleSupported: app.isPackaged && !process.env.FLATPAK_ID }; }
function broadcast() {
  if (worker || broadcastTimer) return;
  broadcastTimer = setTimeout(() => {
    broadcastTimer = null;
    if (!mainWindow || mainWindow.isDestroyed()) return;
    tray?.setToolTip(runtime.busy() ? text('Git Cloner · Sicherung läuft', 'Git Cloner · Backup running') : 'Git Cloner');
    // A hidden or minimized window receives the accumulated state once it becomes visible again.
    if (!mainWindow.isVisible() || mainWindow.isMinimized()) return;
    const snapshot = state();
    if (lastData === snapshot.dataRevision) delete snapshot.repositories;
    else lastData = snapshot.dataRevision;
    const history = `${snapshot.history.length}:${snapshot.history[0]?.finishedAt}`;
    if (history === lastHistory) delete snapshot.history; else lastHistory = history;
    if (lastConfig === snapshot.configRevision) delete snapshot.config;
    else lastConfig = snapshot.configRevision;
    mainWindow.webContents.send('state:changed', snapshot);
  }, 120);
}
function handle(channel, fn) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (event.sender !== mainWindow?.webContents || event.senderFrame !== mainWindow.webContents.mainFrame || event.senderFrame.url !== indexUrl) throw new Error('Nicht erlaubte Anfrage.');
    return fn(...args);
  });
}
async function workerLog(entry) {
  const file = path.join(app.getPath('userData'), 'worker.log');
  try {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const info = await fs.stat(file).catch(() => null);
    if (info?.size > 512000) await fs.rename(file, `${file}.1`);
    await fs.appendFile(file, `${JSON.stringify({ time: new Date().toISOString(), ...entry })}\n`, { mode: 0o600 });
  } catch (_error) { /* A logging failure must not leave the worker alive. */ }
}
function notifyUpdate(result) {
  if (!testMode && runtime.config.notifications && Notification.isSupported()) {
    const notice = new Notification({ title: text('Git Cloner · Update verfügbar', 'Git Cloner · Update available'), body: text(`Version ${result.latestVersion} ist verfügbar. In der App öffnen oder diese Version überspringen.`, `Version ${result.latestVersion} is available. Open the app to view or skip this version.`) });
    notice.on('click', showWindow); presentNotification(notice);
  }
}
function presentNotification(notice) {
  let finish;
  const ready = new Promise(resolve => { const timer = setTimeout(() => finish(),5000); timer.unref?.(); finish = () => {clearTimeout(timer);resolve();}; });
  pendingNotifications.add(ready); void ready.then(() => pendingNotifications.delete(ready));
  notice.once('show',finish); notice.once('failed',finish);
  try { notice.show(); } catch (error) { finish(); throw error; }
}
async function applyOS(old, next) {
  if (next.launchAtLogin !== old.launchAtLogin) await setAutostart(app, next.launchAtLogin);
  const timerChanged = next.systemSchedule !== old.systemSchedule || (next.systemSchedule && JSON.stringify(registrationTimes(next)) !== JSON.stringify(registrationTimes(old)));
  try { if (timerChanged) await setNativeSchedule(app, next); }
  catch (error) { if (timerChanged) await setNativeSchedule(app,old).catch(() => {}); if (next.launchAtLogin !== old.launchAtLogin) await setAutostart(app, old.launchAtLogin); throw error; }
}
async function runBackup() {
  return runtime.run();
}
function notifyBackup(result) {
  const failures = result.errorCount ?? 0;
  const notice = new Notification({ title: failures ? text('Git Cloner · Sicherung prüfen', 'Git Cloner · Review backup') : text('Git Cloner · Prüfung abgeschlossen', 'Git Cloner · Check complete'), body: text(`${result.resultCount} Ergebnisse, ${failures} Fehler.`, `${result.resultCount} results, ${failures} errors.`) });
  notice.on('click',showWindow); presentNotification(notice);
}
async function start() {
  const release = testMode && process.env.GIT_CLONER_TEST_RELEASE;
  const testRepositories = testMode && process.env.GIT_CLONER_TEST_REPOSITORIES ? JSON.parse(process.env.GIT_CLONER_TEST_REPOSITORIES) : null;
  const testRemotes = testMode && process.env.GIT_CLONER_TEST_REMOTES ? JSON.parse(process.env.GIT_CLONER_TEST_REMOTES) : null;
  const testAPI = testMode && process.env.GIT_CLONER_TEST_API ? JSON.parse(process.env.GIT_CLONER_TEST_API) : null;
  const testMounts = testMode && process.env.GIT_CLONER_TEST_MOUNTS ? JSON.parse(process.env.GIT_CLONER_TEST_MOUNTS) : null;
  runtime = await new Runtime({
    directory: app.getPath('userData'), safeStorage, writeWindowsShortcut: (file, options) => shell.writeShortcutLink(file, 'create', options), version: app.getVersion(), applyOS, notifyUpdate, notifyBackup, notificationsAvailable: () => !testMode && Notification.isSupported(),
    environmentState: async () => ({ onBattery: powerMonitor.isOnBatteryPower() }),
    ...(testMounts ? {mountedRoots:async()=>testMounts} : {}),
    ...(testRepositories ? { fetchImpl: async url => {
      const endpoint = new URL(url).pathname;
      const data = testAPI?.[new URL(url).pathname + new URL(url).search] ?? testAPI?.[endpoint] ?? (endpoint.startsWith('/users/') && !endpoint.endsWith('/repos') ? { type: 'User' } : endpoint.endsWith('/repos') ? testRepositories.filter(r => r.full_name.startsWith(endpoint.split('/')[2] + '/')).slice((Number(new URL(url).searchParams.get('page') || 1) - 1) * Number(new URL(url).searchParams.get('per_page') || 100), Number(new URL(url).searchParams.get('page') || 1) * Number(new URL(url).searchParams.get('per_page') || 100)) : testRepositories.find(r => '/repos/' + r.full_name === endpoint));
      return { ok: Boolean(data), status: data ? 200 : 404, json: async () => data };
    } } : {}),
    ...(testRemotes ? { gitFactory: options => {
      const git = new (require('./core/git.cjs').Git)(options), original = git.run;
      git.run = async function(args,opts) { if (args.includes('clone')) await new Promise(resolve => setTimeout(resolve,900)); return original.call(this,args.map(arg => testRemotes[arg] || arg),opts); }; return git;
    } } : {}),
    ...(release ? { updateFetch: async () => ({ ok: true, status: 200, json: async () => ({ tag_name: release }) }) } : {})
  }).init();
  if (worker) {
    app.dock?.hide();
    try {
      const result = await runtime.scheduledRun();
      await workerLog({ event: result.skipped ? 'not-due' : result.busy ? 'busy' : result.paused ? 'paused' : 'complete', results: result.resultCount ?? result.results?.length ?? 0, errors: result.errorCount ?? result.results?.filter(r => r.status === 'error').length ?? 0 });
      await runtime.stop(); await Promise.allSettled([...pendingNotifications]); quitting = true; app.exit((result.errorCount??0)>0 ? 1 : 0);
    } catch (_error) { await workerLog({ event: 'failed' }); quitting = true; app.exit(1); }
    return;
  }
  runtime.on('change', broadcast);
  mainWindow = new BrowserWindow({ width: 1280, height: 900, minWidth: 960, minHeight: 720, title: 'Git Cloner', backgroundColor: '#f6f7f9', icon: path.join(__dirname, '../build/icon.png'), show: false, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true } });
  mainWindow.removeMenu();
  for (const event of ['show', 'restore']) mainWindow.on(event, broadcast);
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', event => event.preventDefault());
  mainWindow.webContents.on('will-attach-webview', event => event.preventDefault());
  mainWindow.on('close', event => { if(!quitting&&runtime.busy()&&!tray){event.preventDefault();return;}if (!quitting && tray && (runtime.config.closeToTray || runtime.busy())) { event.preventDefault(); mainWindow.hide(); } });
  handle('state:get', state);
  handle('config:save', async input => { await runtime.saveConfig(input); return state(); });
  handle('directory:choose', async () => { const result = await dialog.showOpenDialog(mainWindow, { title: text('Vorhandenen Ordner wählen', 'Choose an existing folder'), properties: ['openDirectory', 'createDirectory'] }); return result.canceled ? null : result.filePaths[0]; });
  handle('backup:run', () => {
    if (runtime.busy() || runtime.saving) throw new Error('Bitte den laufenden Vorgang abwarten.');
    if (!runtime.config.sources.some(source => source.enabled)) throw new Error('Bitte zuerst eine Quelle hinzufügen und aktivieren.');
    void runBackup().catch(error => { runtime.notice = error.message; broadcast(); }); return { started: true };
  });
  handle('updates:check', () => runtime.checkUpdates());
  handle('backup:pause', () => runtime.pause());
  handle('backup:resume', () => { if (runtime.busy()) throw new Error('Bitte den laufenden Vorgang abwarten.'); void runtime.resume({ manual: true }).catch(error => { runtime.notice = error.message; broadcast(); }); return { started: true }; });
  handle('backup:discard', () => runtime.discard());
  handle('backup:preview', input => runtime.preview(input));
  handle('changes:open', options => runtime.openChanges(options));
  handle('changes:list', options => runtime.changes.list(options));
  handle('changes:file', options => runtime.changes.file(options));
  handle('changes:close', () => runtime.closeChanges());
  handle('drives:locate', () => runtime.locateDrives());
  handle('history:list',options=>runtime.historyQuery(options));
  handle('history:details',options=>runtime.historyDetails(options));
  handle('history:export',async options=>{const document=runtime.historyExport(options);const result=await dialog.showSaveDialog(mainWindow,{defaultPath:'git-cloner-history-redacted.json',filters:[{name:'JSON',extensions:['json']}]});if(result.canceled)return null;await writeJson(result.filePath,document);return{saved:true,runs:document.runs.length};});
  handle('errors:help',error=>require('./core/error-help.cjs').errorHelp(error));
  handle('rotation:inventory',options=>runtime.rotationInventory(options));
  handle('rotation:run',options=>runtime.rotatePasswords(options));
  handle('rotation:stop',()=>runtime.stopRotation());
  handle('source:recommend',options=>runtime.recommendations(options));
  handle('source:recommend-cancel',()=>runtime.cancelRecommendations());
  handle('sources:organize', input => runtime.organizeSources(input));
  handle('sources:preview', input => runtime.previewSources(input));
  handle('sources:apply', input => runtime.applySources(input));
  handle('repositories:browse-open', input => runtime.repositoryBrowser.open(input));
  handle('repositories:browse-page', input => runtime.repositoryBrowser.page(input));
  handle('repositories:browse-missing', input => runtime.repositoryBrowser.allMissing(input));
  handle('repositories:browse-close', () => { runtime.repositoryBrowser.close(); return true; });
  handle('repositories:browse-add', input => runtime.addBrowserSources(input));
  handle('downloads:history', options => runtime.downloadHistoryQuery(options));
  handle('program:candidates', options => testMode && process.env.GIT_CLONER_TEST_PROGRAMS ? JSON.parse(process.env.GIT_CLONER_TEST_PROGRAMS) : runtime.programCandidates(options));
  handle('downloads:inventory', () => runtime.downloadInventory());
  handle('downloads:preview-cleanup', input => runtime.previewDownloadCleanup(input));
  handle('downloads:cleanup', input => runtime.cleanDownloads(input));
  handle('updates:ignore', () => runtime.ignoreUpdate());
  handle('updates:reset', () => runtime.resetUpdate());
  handle('token:save', (token, accountId = 'default') => runtime.setToken(accountId, token));
  handle('encryption:unlock', ({ password, remember }) => runtime.setPassword(password, remember));
  handle('auth:begin', id => runtime.beginLogin(id));
  handle('auth:cancel', () => { runtime.deviceFlow.cancel(); return true; });
  handle('auth:copy-code', () => { if (!runtime.device?.userCode) throw new Error('Kein Anmeldecode vorhanden.'); clipboard.writeText(runtime.device.userCode); return true; });
  handle('backup:verify', ({ id, passphrase }) => runtime.verify(id, passphrase));
  handle('archive:choose', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], filters: [{ name: 'Git Cloner archive', extensions: ['gcb'] }] });
    if (result.canceled) return null;
    const file = path.resolve(result.filePaths[0]); selectedArchives.add(file); return file;
  });
  handle('backup:restore', options => {
    if (options.archive && !selectedArchives.has(path.resolve(options.archive))) throw new Error('Bitte das Archiv über den Dateidialog auswählen.');
    return runtime.restore(options);
  });
  handle('restore:browse-open', options => { if (options.archive && !selectedArchives.has(path.resolve(options.archive))) throw new Error('Bitte das Archiv über den Dateidialog auswählen.'); return runtime.browseOpen(options); });
  handle('restore:browse-list', options => runtime.browseList(options));
  handle('restore:browse-close', id => runtime.browser.close(id));
  handle('restore:selection', options => runtime.restoreSelection(options));
  handle('settings:export', async () => {
    const result = await dialog.showSaveDialog(mainWindow, { defaultPath: 'git-cloner-settings.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (result.canceled) return null; await writeJson(result.filePath, exportSettings(runtime.config)); return { saved: true };
  });
  handle('settings:import', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (result.canceled) return null;
    const info = await fs.stat(result.filePaths[0]); if (info.size > 2000000) throw new Error('Die Einstellungsdatei ist zu groß.');
    return importSettings(await readJson(result.filePaths[0], null));
  });
  handle('logs:export', async () => {
    const result = await dialog.showSaveDialog(mainWindow, { defaultPath: 'git-cloner-redacted-log.json', filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (result.canceled) return null; await writeJson(result.filePath, redactLogs(runtime.backup.state.history)); return { saved: true };
  });
  const links = { releases: RELEASES_URL, repository: 'https://github.com/Ujap1994/Git-Cloner', git: 'https://git-scm.com/downloads', token: 'https://github.com/settings/personal-access-tokens', device: 'https://github.com/login/device', oauth: 'https://github.com/settings/developers' };
  handle('link:open', name => { if (!Object.hasOwn(links, name)) throw new Error('Unbekannter Link.'); return shell.openExternal(links[name]); });
  handle('destination:open', async id => {
    const source = runtime.config.sources.find(s => s.id === id), record = runtime.backup.state.repositories[id];
    const destination = source?.destination || record?.destination; if (!destination) throw new Error('Ziel nicht gefunden.');
    const error = await shell.openPath(destination); if (error) throw new Error(error);
  });
  handle('program:open-directory', async id => { const record=runtime.record(id), destination=record.installation?.destination; if(!destination)throw new Error('Kein installiertes Programm vorhanden.'); const stat=await fs.lstat(destination); if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error('Programmordner nicht verfügbar.'); const error=await shell.openPath(destination); if(error)throw new Error(error); });
  handle('releases:open-directory', async id => {
    const destination = await runtime.releaseDestination(id);
    const error = await shell.openPath(destination); if (error) throw new Error(error);
  });
  try {
    const image = nativeImage.createFromPath(path.join(__dirname, '../build/tray.png')); if (process.platform === 'darwin') image.setTemplateImage(true);
    tray = new Tray(image); tray.setContextMenu(Menu.buildFromTemplate([
      { label: text('Git Cloner öffnen', 'Open Git Cloner'), click: showWindow },
      { label: text('Jetzt prüfen', 'Check now'), click: () => { if (runtime.config.sources.some(s => s.enabled)) void runBackup().catch(error => { runtime.notice = error.message; broadcast(); }); } },
      { type: 'separator' }, { label: text('Beenden', 'Quit'), click: () => app.quit() }
    ])); tray.on('click', showWindow);
  } catch (_error) { runtime.notice = text('Kein Infobereich verfügbar. Das Fenster bleibt für Hintergrundsicherungen geöffnet.', 'No system tray is available. Keep the window open for background checks.'); }
  await mainWindow.loadFile(indexFile);
  const loginStart = process.platform === 'darwin' && app.getLoginItemSettings().wasOpenedAtLogin;
  if ((!process.argv.includes('--hidden') && !loginStart) || !tray) showWindow();
  broadcast();
  if (!testMode) { runtime.start(); powerMonitor.on('resume', () => { runtime.lastEnvironmentAt = 0; void runtime.policyTick(); void runtime.scheduler.tick(); void runtime.drives.tick(); }); for (const event of ['on-ac','on-battery']) powerMonitor.on(event,() => { runtime.lastEnvironmentAt = 0; void runtime.policyTick(); }); }
  if (pendingWorker) void runtime.scheduledRun();
}
app.on('activate', showWindow);
app.on('window-all-closed', () => { if (!tray || !runtime?.config.closeToTray) app.quit(); });
app.on('before-quit', event => {
  if (runtime?.operation === 'previewing-changes' && !quitting) { event.preventDefault(); quitting = true; void runtime.closeChanges().finally(() => app.quit()); return; }
  if (runtime?.busy() && !quitting) { event.preventDefault(); showWindow(); void dialog.showMessageBox(mainWindow, { type: 'info', message: text('Ein Vorgang läuft. Bitte den Abschluss abwarten.', 'An operation is running. Please wait for it to finish.'), buttons: ['OK'] }); return; }
  if (!quitting && runtime?.browser.sessions.size) { event.preventDefault(); quitting = true; void runtime.stop().finally(() => app.quit()); return; }
  quitting = true; void runtime?.stop(); clearTimeout(broadcastTimer);
});
