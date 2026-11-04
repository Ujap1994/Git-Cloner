const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

function desktopQuote(value) {
  return `"${value.replace(/%/g, '%%').replace(/[\\"`$]/g, '\\$&')}"`;
}

async function setAutostart(app, enabled, { platform = process.platform, appImage = process.env.APPIMAGE, flatpakId = process.env.FLATPAK_ID, hostConfig = process.env.HOST_XDG_CONFIG_HOME } = {}) {
  if (enabled && !app.isPackaged) throw new Error('Autostart ist erst in der installierten App verfügbar.');
  if (platform === 'linux') {
    const directory = path.join(flatpakId ? (hostConfig || path.join(os.homedir(), '.config')) : app.getPath('appData'), 'autostart');
    const file = path.join(directory, 'git-cloner.desktop');
    if (!enabled) { await fs.rm(file, { force: true }); return; }
    const command = flatpakId ? `flatpak run ${desktopQuote(flatpakId)}` : desktopQuote(appImage || app.getPath('exe'));
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(file, `[Desktop Entry]\nType=Application\nName=Git Cloner\nComment=Geplante GitHub-Sicherungen\nExec=${command} --hidden\nTerminal=false\nX-GNOME-Autostart-enabled=true\n`, { mode: 0o600 });
  } else {
    app.setLoginItemSettings({ openAtLogin: enabled, path: app.getPath('exe'), args: ['--hidden'] });
    if (app.getLoginItemSettings({ path: app.getPath('exe'), args: ['--hidden'] }).openAtLogin !== enabled) throw new Error('Autostart konnte vom Betriebssystem nicht übernommen werden.');
  }
}

module.exports = { setAutostart, desktopQuote };
