const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execute = promisify(execFile);
const { registrationTimes } = require('./schedule.cjs');
const { readJson, writeJson } = require('./store.cjs');
const ID = 'io.github.Ujap1994.GitCloner.backup';
const xml = value =>
  String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
function quote(value) {
  return `"${value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/%/g, '%%')
    .replace(/\$/g, () => '$$')}"`;
}
function scheduleFiles({ platform, executable, times, profile, configDirectory, home, username = '', uid = 1000 }) {
  if (!path.isAbsolute(executable) || /[\r\n\0]/.test(executable))
    throw new Error('Ungültiger Programmpfad für die System-Zeitplanung.');
  if (!times.length || times.some(t => !/^([01]\d|2[0-3]):[0-5]\d$/.test(t)))
    throw new Error('Ungültige System-Prüfzeiten.');
  if (platform === 'darwin') {
    const intervals = times
      .map(t => {
        const [h, m] = t.split(':').map(Number);
        return `<dict><key>Hour</key><integer>${h}</integer><key>Minute</key><integer>${m}</integer></dict>`;
      })
      .join('');
    const content = `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>${ID}</string><key>ProgramArguments</key><array><string>${xml(executable)}</string><string>--scheduled-worker</string></array><key>StartCalendarInterval</key><array>${intervals}</array><key>ProcessType</key><string>Background</string><key>StandardOutPath</key><string>${xml(path.join(profile, 'worker.log'))}</string><key>StandardErrorPath</key><string>${xml(path.join(profile, 'worker.log'))}</string></dict></plist>`;
    const file = path.join(home, 'Library', 'LaunchAgents', `${ID}.plist`);
    return {
      files: [{ file, content }],
      enable: [['launchctl', ['bootstrap', `gui/${uid}`, file]]],
      disable: [['launchctl', ['bootout', `gui/${uid}/${ID}`]]]
    };
  }
  if (platform === 'win32') {
    const files = [],
      enable = [],
      disable = [];
    for (let offset = 0; offset < times.length; offset += 48) {
      const index = Math.floor(offset / 48) + 1,
        task = taskName(index),
        file = taskFile(profile, index);
      const triggers = times
        .slice(offset, offset + 48)
        .map(
          t =>
            `<CalendarTrigger><StartBoundary>2020-01-01T${t}:00</StartBoundary><Enabled>true</Enabled><ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay></CalendarTrigger>`
        )
        .join('');
      const content = `<?xml version="1.0" encoding="UTF-8"?><Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task"><Triggers>${triggers}</Triggers><Principals><Principal id="User"><UserId>${xml(username)}</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals><Settings><MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy><DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries><StopIfGoingOnBatteries>false</StopIfGoingOnBatteries><StartWhenAvailable>true</StartWhenAvailable><ExecutionTimeLimit>PT12H</ExecutionTimeLimit></Settings><Actions Context="User"><Exec><Command>${xml(executable)}</Command><Arguments>--scheduled-worker</Arguments></Exec></Actions></Task>`;
      files.push({ file, content });
      enable.push(['schtasks', ['/Create', '/TN', task, '/XML', file, '/F']]);
      disable.push(['schtasks', ['/Delete', '/TN', task, '/F']]);
    }
    return { files, enable, disable, taskCount: files.length };
  }
  const folder = path.join(configDirectory, 'systemd', 'user');
  return {
    files: [
      {
        file: path.join(folder, 'git-cloner-backup.service'),
        content: `[Unit]\nDescription=Git Cloner backup\n[Service]\nType=oneshot\nExecStart=${quote(executable)} --scheduled-worker\n`
      },
      {
        file: path.join(folder, 'git-cloner-backup.timer'),
        content: `[Unit]\nDescription=Git Cloner daily checks\n[Timer]\n${times.map(t => `OnCalendar=*-*-* ${t}:00`).join('\n')}\nPersistent=true\nAccuracySec=1min\n[Install]\nWantedBy=timers.target\n`
      }
    ],
    enable: [
      ['systemctl', ['--user', 'daemon-reload']],
      ['systemctl', ['--user', 'enable', '--now', 'git-cloner-backup.timer']]
    ],
    disable: [['systemctl', ['--user', 'disable', '--now', 'git-cloner-backup.timer']]]
  };
}
async function setNativeSchedule(
  app,
  config,
  { platform = process.platform, exec = execute, snap = process.env.SNAP } = {}
) {
  if (config.systemSchedule && (!app.isPackaged || process.env.FLATPAK_ID || snap))
    throw new Error('Die unabhängige Zeitplanung benötigt eine installierte native App.');
  const times = registrationTimes(config),
    enabled = config.systemSchedule && times.length > 0,
    profile = app.getPath('userData');
  const spec = scheduleFiles({
    platform,
    executable: process.env.APPIMAGE || app.getPath('exe'),
    times: times.length ? times : config.schedule.times,
    profile,
    configDirectory: app.getPath('appData'),
    home: os.homedir(),
    username: process.env.USERDOMAIN ? `${process.env.USERDOMAIN}\\${os.userInfo().username}` : os.userInfo().username,
    uid: process.getuid?.() ?? 1000
  });
  const previous = platform === 'win32' ? await readJson(path.join(profile, 'native-tasks.json'), null) : null;
  const oldCount =
    Number.isInteger(previous?.taskCount) && previous.taskCount >= 0 && previous.taskCount <= 30
      ? previous.taskCount
      : 1;
  if (platform === 'win32')
    for (let index = spec.taskCount + 1; index <= oldCount; index++)
      spec.disable.push(['schtasks', ['/Delete', '/TN', taskName(index), '/F']]);
  // Disable only our own registration. Missing registrations are normal.
  for (const [command, args] of spec.disable)
    try {
      await exec(command, args, { windowsHide: true, timeout: 30000 });
    } catch (_error) {
      /* Not registered yet. */
    }
  if (platform === 'win32')
    for (let index = spec.taskCount + 1; index <= oldCount; index++)
      await fs.rm(taskFile(profile, index), { force: true });
  if (!enabled) {
    for (const entry of spec.files) await fs.rm(entry.file, { force: true });
    if (platform === 'win32') await writeJson(path.join(profile, 'native-tasks.json'), { taskCount: 0 });
    return;
  }
  for (const entry of spec.files) {
    await fs.mkdir(path.dirname(entry.file), { recursive: true });
    await fs.writeFile(entry.file, entry.content, { mode: 0o600 });
  }
  try {
    for (const [command, args] of spec.enable) await exec(command, args, { windowsHide: true, timeout: 30000 });
    if (platform === 'win32') await writeJson(path.join(profile, 'native-tasks.json'), { taskCount: spec.taskCount });
  } catch (_error) {
    for (const [command, args] of spec.disable)
      try {
        await exec(command, args, { windowsHide: true, timeout: 30000 });
      } catch (_missing) {
        /* Roll back our partially created tasks. */
      }
    for (const entry of spec.files) await fs.rm(entry.file, { force: true });
    throw new Error('Die System-Zeitplanung konnte nicht aktiviert werden. Benutzeranmeldung und Systemdienst prüfen.');
  }
}
function taskName(index) {
  return index === 1 ? 'Git Cloner Backup' : `Git Cloner Backup ${index}`;
}
function taskFile(profile, index) {
  return path.join(profile, index === 1 ? 'scheduled-task.xml' : `scheduled-task-${index}.xml`);
}
module.exports = { scheduleFiles, setNativeSchedule };
