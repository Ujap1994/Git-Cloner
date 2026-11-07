const path = require('node:path');
const { createHash } = require('node:crypto');
const PROVIDERS = ['github', 'gitlab', 'forgejo'];
function providerSpec(input = {}) {
  const provider = input.provider ?? 'github';
  if (!PROVIDERS.includes(provider)) throw new Error('Unbekannter Git-Anbieter.');
  let value =
    input.server || (provider === 'github' ? 'https://github.com' : provider === 'gitlab' ? 'https://gitlab.com' : '');
  if (typeof value !== 'string' || value.length > 2048) throw new Error('Die Serveradresse ist zu lang.');
  if (/%2f|%5c|%2e|\\/i.test(value)) throw new Error('Ungültiger Serverpfad.');
  let url;
  try {
    url = new URL(value);
  } catch (_error) {
    throw new Error('Bitte eine vollständige HTTPS-Serveradresse angeben.');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    /%2f|%5c|%2e/i.test(url.pathname) ||
    url.pathname.includes('\\')
  )
    throw new Error('Der Git-Server benötigt HTTPS ohne Zugangsdaten, Abfrage oder Fragment.');
  value = url.href.replace(/\/+$/, '');
  if (provider === 'github' && value !== 'https://github.com')
    throw new Error('GitHub-Quellen verwenden https://github.com.');
  return { provider, server: value };
}
function parseHostedSource(value, kind, input = {}) {
  const spec = providerSpec(input);
  if (spec.provider === 'github') return require('./config.cjs').parseSource(value, kind);
  if (typeof value !== 'string') throw new Error('Bitte eine Git-Quelle angeben.');
  let result = value.trim().replace(/\/+$/, '');
  if (/^https?:\/\//i.test(result)) {
    let url;
    try {
      url = new URL(result);
    } catch (_error) {
      throw new Error('Ungültige Repository-Adresse.');
    }
    if (url.username || url.password || url.search || url.hash || !url.href.startsWith(spec.server + '/'))
      throw new Error('Die Quelle muss zum ausgewählten HTTPS-Server gehören.');
    result = decodeURIComponent(url.href.slice(spec.server.length + 1));
  }
  result = result.replace(/\.git$/, '');
  const parts = result.split('/'),
    valid = parts.every(
      p =>
        /^[a-z\d_][a-z\d._-]{0,99}$/i.test(p) &&
        !['.', '..'].includes(p) &&
        !/[.]$/.test(p) &&
        !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)
    );
  const maximum = spec.provider === 'forgejo' ? (kind === 'owner' ? 1 : 2) : 16;
  if (
    !valid ||
    parts.length > maximum ||
    (kind === 'repository' && parts.length < 2) ||
    (spec.provider === 'forgejo' && kind === 'repository' && parts.length !== 2)
  )
    throw new Error('Ungültiger Konto-, Gruppen- oder Repository-Pfad.');
  return result;
}
function providerKey(source = {}) {
  const spec = providerSpec(source);
  return `${spec.provider}:${spec.server}`;
}
function repositoryIdentity(source, fullName) {
  return `${providerKey(source)}:${fullName.toLowerCase()}`;
}
function repositoryParts(source, fullName) {
  const spec = providerSpec(source),
    parts = parseHostedSource(fullName, 'repository', spec).split('/');
  if (spec.provider === 'github') return parts;
  const server = new URL(spec.server),
    hash = createHash('sha256').update(spec.server).digest('hex').slice(0, 12);
  return [`${spec.provider}-${server.hostname.replace(/[^a-z\d.-]/gi, '_').slice(0, 80)}-${hash}`, ...parts];
}
function repositoryDestination(source, fullName) {
  return path.resolve(source.destination, ...repositoryParts(source, fullName));
}
function cloneURL(source, fullName, wiki = false) {
  const spec = providerSpec(source);
  return `${spec.server}/${parseHostedSource(fullName, 'repository', spec)}${wiki ? '.wiki' : ''}.git`;
}
module.exports = {
  PROVIDERS,
  providerSpec,
  parseHostedSource,
  providerKey,
  repositoryIdentity,
  repositoryParts,
  repositoryDestination,
  cloneURL
};
