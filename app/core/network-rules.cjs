const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const execute = promisify(execFile);
async function networkName({ platform = process.platform, exec = execute } = {}) {
  const run = async (command, args) =>
    (await exec(command, args, { windowsHide: true, timeout: 5000, maxBuffer: 131072 })).stdout;
  try {
    if (platform === 'darwin') {
      const ports = await run('/usr/sbin/networksetup', ['-listallhardwareports']);
      const device = ports.match(/Hardware Port: (?:Wi-Fi|AirPort)\s+Device: (\S+)/)?.[1];
      if (!device) return null;
      const out = await run('/usr/sbin/networksetup', ['-getairportnetwork', device]);
      return out.match(/^Current (?:Wi-Fi|AirPort) Network: (.+)$/m)?.[1]?.trim() || null;
    }
    if (platform === 'win32')
      return (await run('netsh', ['wlan', 'show', 'interfaces'])).match(/^\s*SSID\s*:\s*(.+)$/m)?.[1]?.trim() || null;
    const out = await run('nmcli', ['-t', '-f', 'active,ssid', 'dev', 'wifi']);
    return (
      out
        .split('\n')
        .find(line => line.startsWith('yes:'))
        ?.slice(4)
        .replace(/\\([\\:])/g, '$1') || null
    );
  } catch (_error) {
    return null;
  }
}
function restriction(execution, { onBattery = null, network = null } = {}) {
  if (execution.onlyOnAC && onBattery !== false) return 'power';
  if (execution.allowedNetworks.length && !execution.allowedNetworks.includes(network))
    return network ? 'network' : 'network-unknown';
  return null;
}
module.exports = { networkName, restriction };
