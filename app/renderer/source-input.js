/* global module */
(function (root) {
  function normalizeSourceInput(value, { provider = 'github', server = 'https://github.com', kind = 'auto' } = {}) {
    if (typeof value !== 'string') throw new Error('Bitte eine Git-Quelle angeben.');
    const original = value.trim();
    let input = original.replace(/\/+$/, ''),
      fromURL = false,
      detected = kind;
    if (/^https?:\/\//i.test(input)) {
      let url;
      try {
        url = new URL(input);
      } catch (_error) {
        throw new Error('Ungültige Repository-Adresse.');
      }
      if (url.protocol !== 'https:' || url.username || url.password)
        throw new Error('Bitte eine HTTPS-Quelle ohne eingebettete Zugangsdaten verwenden.');
      fromURL = true;
      if (provider === 'github') {
        if (
          url.hostname !== 'github.com' ||
          url.port ||
          [...url.searchParams.keys()].some(key => !['tab', 'type', 'language', 'sort', 'page', 'q'].includes(key))
        )
          throw new Error('Bitte nur GitHub-HTTPS-Adressen verwenden.');
        const parts = url.pathname.split('/').filter(Boolean);
        if (parts[0] === 'orgs' && (parts.length === 2 || (parts.length === 3 && parts[2] === 'repositories'))) {
          input = parts[1];
          detected = 'owner';
        } else {
          if (
            parts.length > 2 &&
            !['tree', 'blob', 'issues', 'pulls', 'releases', 'actions', 'wiki', 'commits', 'discussions'].includes(
              parts[2]
            )
          )
            throw new Error('Bitte eine Konto- oder Repository-Seite angeben.');
          input = parts.slice(0, 2).join('/');
          detected = parts.length === 1 ? 'owner' : 'repository';
        }
      } else {
        const base = new URL(server);
        if (
          url.origin !== base.origin ||
          !url.pathname.startsWith(base.pathname.replace(/\/$/, '') + '/') ||
          url.search ||
          url.hash
        )
          throw new Error('Quelle und ausgewählter HTTPS-Server passen nicht zusammen.');
        input = decodeURIComponent(url.pathname.slice(base.pathname.replace(/\/$/, '').length + 1));
        if (provider === 'gitlab' && input.startsWith('groups/') && input.includes('/-/')) {
          input = input.slice(7).split('/-/')[0];
          detected = 'owner';
        } else if (provider === 'gitlab') input = input.split('/-/')[0];
      }
    }
    input = input.replace(/\/+$/, '').replace(/\.git$/i, '');
    if (detected === 'auto') detected = input.includes('/') ? 'repository' : 'owner';
    return { value: input, kind: detected, fromURL, ownerPage: fromURL && detected === 'owner', original };
  }
  if (typeof module === 'object' && module.exports) module.exports = { normalizeSourceInput };
  else root.gitClonerNormalizeSource = normalizeSourceInput;
})(globalThis);
