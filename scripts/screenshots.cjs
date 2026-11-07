// Regenerates the documentation screenshots with the English interface. Short temporary paths keep the images free of
// user names; only this script writes to docs/screenshots, normal test runs leave tracked files unchanged.
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const cli = path.join(path.dirname(require.resolve('@playwright/test/package.json')), 'cli.js');
const result = spawnSync(process.execPath, [cli, 'test', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, GIT_CLONER_SCREENSHOTS: '1', ...(process.platform === 'win32' ? {} : { TMPDIR: '/tmp' }) }
});
process.exit(result.status ?? 1);
