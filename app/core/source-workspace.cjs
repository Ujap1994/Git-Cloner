const { createHash, randomUUID } = require('node:crypto');
const { validateConfig, validateBackup, validateFilters, validateSchedule } = require('./config.cjs');
const { providerSpec, providerKey, parseHostedSource, repositoryIdentity } = require('./provider-spec.cjs');
const { normalizeSourceInput } = require('../renderer/source-input.js');
const { includesRepository } = require('./filters.cjs');

function selectedSources(config, ids) {
  if (
    !Array.isArray(ids) ||
    !ids.length ||
    ids.length > 100 ||
    new Set(ids).size !== ids.length ||
    ids.some(id => typeof id !== 'string')
  )
    throw new Error('Bitte 1 bis 100 unterschiedliche Quellen auswählen.');
  const selected = ids.map(id => config.sources.find(source => source.id === id));
  if (selected.some(source => !source)) throw new Error('Eine ausgewählte Quelle wurde inzwischen entfernt.');
  return selected;
}

function organizeConfig(config, input) {
  if (!input || typeof input !== 'object') throw new Error('Ungültige Organisation der Quellen.');
  const next = structuredClone(config);
  next.sourceGroups ??= [];
  if (input.group) {
    const { id, name, remove } = input.group;
    if (typeof id !== 'string' || !/^[a-z\d-]{1,64}$/i.test(id)) throw new Error('Ungültige Quellengruppe.');
    const previous = next.sourceGroups.find(group => group.id === id);
    if (remove === true) {
      if (!previous) throw new Error('Quellengruppe nicht gefunden.');
      next.sourceGroups = next.sourceGroups.filter(group => group.id !== id);
      for (const source of next.sources) if (source.groupId === id) source.groupId = null;
    } else if (previous) previous.name = name;
    else next.sourceGroups.push({ id, name });
  }
  if (input.ids) {
    const sources = selectedSources(next, input.ids);
    if (!Object.hasOwn(input, 'favorite') && !Object.hasOwn(input, 'groupId'))
      throw new Error('Bitte eine Änderung auswählen.');
    for (const source of sources) {
      if (Object.hasOwn(input, 'favorite')) source.favorite = input.favorite;
      if (Object.hasOwn(input, 'groupId')) source.groupId = input.groupId;
    }
  } else if (!input.group) throw new Error('Bitte eine Änderung auswählen.');
  return validateConfig(next);
}

const bulkFields = new Set([
  'enabled',
  'favorite',
  'groupId',
  'destination',
  'accountId',
  'filters',
  'backup',
  'schedule'
]);
function prepareBulk(config, { ids, patch } = {}) {
  const next = structuredClone(config),
    sources = selectedSources(next, ids);
  if (
    !patch ||
    typeof patch !== 'object' ||
    Array.isArray(patch) ||
    !Object.keys(patch).length ||
    Object.keys(patch).some(key => !bulkFields.has(key))
  )
    throw new Error('Ungültige gemeinsame Quellenänderung.');
  for (const source of sources) {
    if (Object.hasOwn(patch, 'destination') && source.destination !== patch.destination) {
      delete source.volumeId;
      delete source.volumeHint;
    }
    for (const [key, value] of Object.entries(patch)) {
      if (key === 'backup' && value !== null) {
        if (!value || typeof value !== 'object' || Array.isArray(value))
          throw new Error('Ungültige gemeinsame Sicherungsoptionen.');
        const base = source.backup ?? config.backup;
        source.backup = validateBackup({ ...base, ...value, metadata: { ...base.metadata, ...value?.metadata } });
      } else if (key === 'filters') {
        if (!value || typeof value !== 'object' || Array.isArray(value))
          throw new Error('Ungültige gemeinsame Filter.');
        source.filters = validateFilters({ ...source.filters, ...value });
      } else if (key === 'schedule') source.schedule = value === null ? null : validateSchedule(value);
      else source[key] = structuredClone(value);
    }
  }
  const validated = validateConfig(next);
  const changes = sources
    .map(source => {
      const before = config.sources.find(value => value.id === source.id),
        after = validated.sources.find(value => value.id === source.id);
      const fields = Object.keys(patch)
        .filter(field => JSON.stringify(before[field]) !== JSON.stringify(after[field]))
        .map(field => ({ field, before: before[field] ?? null, after: after[field] ?? null }));
      return { id: source.id, value: source.value, fields };
    })
    .filter(source => source.fields.length);
  return { config: validated, changes, selected: sources.length, changed: changes.length };
}

function configSignature(config) {
  return createHash('sha256').update(JSON.stringify(config)).digest('hex');
}

class RepositoryBrowser {
  constructor({ clientFor, getConfig, now = () => Date.now() }) {
    Object.assign(this, { clientFor, getConfig, now });
  }
  close() {
    this.controller?.abort();
    this.session = null;
  }
  async open(input = {}) {
    this.close();
    const spec = providerSpec(input),
      normalized = normalizeSourceInput(input.owner, { ...spec, kind: 'owner' }),
      owner = parseHostedSource(normalized.value, 'owner', spec),
      config = this.getConfig();
    const accountId = input.accountId ?? 'default';
    if (
      accountId !== 'default' &&
      !config.accounts.some(account => account.id === accountId && providerKey(account) === providerKey(spec))
    )
      throw new Error('Zugangsdaten und Anbieter passen nicht zusammen.');
    const source = { ...spec, accountId },
      client = this.clientFor(source),
      controller = new AbortController();
    this.controller = controller;
    const context = await client.repositoryContext(owner, { signal: controller.signal });
    controller.signal.throwIfAborted();
    const session = {
      id: randomUUID(),
      source,
      owner,
      client,
      context,
      loaded: new Map(),
      pages: new Map(),
      expiresAt: this.now() + 900000
    };
    this.session = session;
    return this.page({ sessionId: session.id, page: 1, query: '' });
  }
  current(id) {
    if (!this.session || this.session.id !== id || this.session.expiresAt < this.now())
      throw new Error('Die Repository-Auswahl ist abgelaufen. Bitte erneut öffnen.');
    return this.session;
  }
  async page({ sessionId, page = 1, query = '' } = {}) {
    const session = this.current(sessionId);
    if (
      !Number.isSafeInteger(page) ||
      page < 1 ||
      page > 1000 ||
      typeof query !== 'string' ||
      query.length > 100 ||
      Array.from(query).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
    )
      throw new Error('Ungültige Repository-Suche oder Seite.');
    query = query.trim();
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    const key = `${query}\0${page}`;
    let result = session.pages.get(key);
    if (!result) {
      result = await session.client.repositoryPage(session.context, {
        page,
        query,
        perPage: 50,
        signal: controller.signal
      });
      controller.signal.throwIfAborted();
      this.current(sessionId);
      if (!Array.isArray(result.repositories) || result.repositories.length > 100)
        throw new Error('Der Anbieter liefert keine gültige Repository-Seite.');
      result = {
        ...result,
        repositories: result.repositories.map(repository => {
          const value = parseHostedSource(repository.full_name, 'repository', session.source);
          if (!value.toLowerCase().startsWith(session.owner.toLowerCase() + '/'))
            throw new Error('Der Anbieter liefert ein Repository außerhalb der ausgewählten Quelle.');
          const item = {
            value,
            name: value.split('/').at(-1),
            description: typeof repository.description === 'string' ? repository.description.slice(0, 500) : '',
            private: Boolean(repository.private || repository.visibility === 'private'),
            archived: Boolean(repository.archived),
            fork: Boolean(repository.fork),
            size: Number.isFinite(repository.size) && repository.size >= 0 ? repository.size : null
          };
          if (!session.loaded.has(value.toLowerCase()) && session.loaded.size >= 10000)
            throw new Error(
              'Die Auswahl enthält sehr viele Einträge. Bitte den Browser neu öffnen und die Suche eingrenzen.'
            );
          session.loaded.set(value.toLowerCase(), item);
          return item;
        })
      };
      if (session.loaded.size > 10000)
        throw new Error(
          'Die Auswahl enthält sehr viele Einträge. Bitte den Browser neu öffnen und die Suche eingrenzen.'
        );
      session.pages.set(key, result);
      if (session.pages.size > 30) session.pages.delete(session.pages.keys().next().value);
    }
    session.expiresAt = this.now() + 900000;
    const existing = new Map(
      this.getConfig()
        .sources.filter(source => source.kind === 'repository')
        .map(source => [repositoryIdentity(source, source.value), source.enabled])
    );
    return {
      sessionId,
      owner: session.owner,
      ...session.source,
      page,
      query,
      hasMore: Boolean(result.hasMore),
      limited: Boolean(result.limited),
      total: Number.isSafeInteger(result.total) ? result.total : null,
      repositories: result.repositories.map(item => ({
        ...item,
        existing: existing.has(repositoryIdentity(session.source, item.value)),
        existingEnabled: existing.get(repositoryIdentity(session.source, item.value)) ?? null
      }))
    };
  }
  async allMissing({ sessionId, template = {} } = {}) {
    const session = this.current(sessionId),
      config = this.getConfig(),
      available = Math.max(0, 100 - config.sources.length),
      filters = template.filters ?? {};
    const first = await this.page({ sessionId, page: 1, query: '' }),
      existingOwner = config.sources.find(
        source =>
          source.kind === 'owner' &&
          providerKey(source) === providerKey(session.source) &&
          source.value.toLowerCase() === session.owner.toLowerCase()
      );
    if (existingOwner)
      return { ...first, selection: [], coveredByOwner: true, ownerSourceId: existingOwner.id, available };
    const selection = new Map();
    let current = first,
      examined = 0;
    for (;;) {
      for (const item of current.repositories) {
        examined++;
        if (!item.existing && includesRepository({ ...item, full_name: item.value }, filters))
          selection.set(item.value.toLowerCase(), item);
        if (selection.size > available)
          return { ...first, selection: [], overflow: true, available, minimumMissing: selection.size, examined };
      }
      if (!current.hasMore) break;
      current = await this.page({ sessionId, page: current.page + 1, query: '' });
    }
    return { ...first, selection: [...selection.values()], examined, available };
  }
  sourceTemplate(input) {
    const template = {};
    for (const key of ['filters', 'backup', 'schedule', 'additionalDestinations'])
      if (Object.hasOwn(input ?? {}, key)) template[key] = structuredClone(input[key]);
    return template;
  }
  ownerSelection({ sessionId, destination, groupId = null, favorite = false, template } = {}) {
    const session = this.current(sessionId),
      config = this.getConfig(),
      next = structuredClone(config);
    const existing = next.sources.find(
      source =>
        source.kind === 'owner' &&
        providerKey(source) === providerKey(session.source) &&
        source.value.toLowerCase() === session.owner.toLowerCase()
    );
    if (existing) return { config: next, added: 0, skipped: 1 };
    next.sources.push({
      ...this.sourceTemplate(template),
      ...session.source,
      id: randomUUID(),
      kind: 'owner',
      value: session.owner,
      destination,
      enabled: true,
      groupId,
      favorite
    });
    return { config: validateConfig(next), added: 1, skipped: 0 };
  }
  selection({ sessionId, repositories, destination, groupId = null, favorite = false, template } = {}) {
    const session = this.current(sessionId),
      config = this.getConfig();
    if (
      !Array.isArray(repositories) ||
      !repositories.length ||
      repositories.length > 100 ||
      repositories.some(value => typeof value !== 'string') ||
      new Set(repositories.map(value => value.toLowerCase())).size !== repositories.length
    )
      throw new Error('Bitte 1 bis 100 unterschiedliche Repositories auswählen.');
    const existing = new Set(
      config.sources
        .filter(source => source.kind === 'repository')
        .map(source => repositoryIdentity(source, source.value))
    );
    const next = structuredClone(config);
    let skipped = 0;
    for (const name of repositories) {
      const item = session.loaded.get(name.toLowerCase());
      if (!item) throw new Error('Ein Repository gehört nicht zur geladenen Auswahl.');
      if (existing.has(repositoryIdentity(session.source, item.value))) {
        skipped++;
        continue;
      }
      next.sources.push({
        ...this.sourceTemplate(template),
        ...session.source,
        id: randomUUID(),
        kind: 'repository',
        value: item.value,
        destination,
        enabled: true,
        groupId,
        favorite
      });
    }
    return { config: validateConfig(next), added: next.sources.length - config.sources.length, skipped };
  }
}

module.exports = { selectedSources, organizeConfig, prepareBulk, configSignature, RepositoryBrowser };
