const fs = require('node:fs/promises');
const path = require('node:path');
async function spaceReady(queue, { statfs = fs.statfs } = {}) {
  const blocked = Object.values(queue?.blockedSpaces ?? {});
  if (!blocked.length) return false;
  for (const item of blocked) {
    if (typeof item.root !== 'string' || !path.isAbsolute(item.root) || !/^\d{1,30}$/.test(item.requiredBytes ?? ''))
      return false;
    try {
      const stat = await statfs(item.root, { bigint: true });
      if (stat.bavail * stat.bsize < BigInt(item.requiredBytes)) return false;
    } catch (_error) {
      return false;
    }
  }
  return true;
}
module.exports = { spaceReady };
