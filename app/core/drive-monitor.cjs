const path = require('node:path');
const { verifyDestination } = require('./destinations.cjs');

class DriveMonitor {
  constructor({ getConfig, run, verify = verifyDestination, onError = () => {} }) {
    Object.assign(this, { getConfig, run, verify, onError });
    this.presence = new Map();
    this.pending = new Set();
    this.ticking = false;
  }
  start() {
    this.stop();
    this.timer = setInterval(() => void this.tick(), 30000);
    this.timer.unref?.();
    void this.tick();
  }
  stop() {
    clearInterval(this.timer);
  }
  async tick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const config = this.getConfig();
      if (!config.onDriveConnect) {
        this.pending.clear();
        this.presence.clear();
        return;
      }
      const roots = new Map();
      for (const source of config.sources.filter(s => s.enabled))
        for (const target of [
          { id: 'primary', destination: source.destination, volumeId: source.volumeId },
          ...(source.additionalDestinations ?? [])
        ]) {
          const key = `${path.resolve(target.destination)}:${target.volumeId}`;
          if (!roots.has(key)) roots.set(key, { ...target, ids: [] });
          roots.get(key).ids.push(`${source.id}:${target.id}`);
        }
      for (const [key, target] of roots) {
        let available = false;
        try {
          await this.verify(target);
          available = true;
        } catch (_error) {
          /* Offline drives are expected. */
        }
        if (available && this.presence.get(key) !== true) for (const id of target.ids) this.pending.add(id);
        if (!available) for (const id of target.ids) this.pending.delete(id);
        this.presence.set(key, available);
      }
      const valid = new Set([...roots.values()].flatMap(root => root.ids));
      this.pending = new Set([...this.pending].filter(id => valid.has(id)));
      if (this.pending.size) {
        const result = await this.run([...this.pending]);
        if (!result.busy) this.pending.clear();
      }
    } catch (error) {
      this.onError(error);
    } finally {
      this.ticking = false;
    }
  }
}
module.exports = { DriveMonitor };
