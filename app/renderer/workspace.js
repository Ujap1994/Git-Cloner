window.createGitClonerWorkspace = function ({
  api,
  t,
  esc,
  field,
  button,
  panel,
  heading,
  icon,
  toggle,
  toast,
  attempt,
  studio,
  enhancements,
  getState,
  getView,
  getSourceDraft,
  mutate
}) {
  const selected = new Set();
  let search = '',
    group = 'all',
    favorites = false,
    page = 0,
    signature = '';
  let browser,
    browserSequence = 0,
    browserTimer,
    browserLoading = false,
    browserTemplate = {},
    accountsSignature = '';
  const picked = new Map();
  let bulkIds = [],
    bulkToken = null,
    bulkChanges = [],
    bulkPage = 0;
  const state = () => getState();
  const locked = () => state().busy || Boolean(state().queue);
  const groups = () => state().config.sourceGroups || [];
  const options = (value, includeKeep = false, placeholder = t('Unverändert lassen', 'Keep unchanged')) =>
    `${includeKeep ? `<option value="keep">${esc(placeholder)}</option>` : ''}<option value="">${t('Ohne Gruppe', 'No group')}</option>${groups()
      .map(item => `<option value="${esc(item.id)}"${item.id === value ? ' selected' : ''}>${esc(item.name)}</option>`)
      .join('')}`;
  const star = active =>
    `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" fill="${active ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="m12 3 2.8 5.7 6.3.9-4.5 4.4 1.1 6.2L12 17.3l-5.7 3 1.1-6.3L3 9.6l6.2-.9Z"/></svg>`;
  function filtered() {
    const query = search.trim().toLowerCase();
    return state().config.sources.filter(
      source =>
        (!query ||
          `${source.value} ${source.destination} ${source.provider || 'github'} ${source.server || ''}`
            .toLowerCase()
            .includes(query)) &&
        (group === 'all' || (group === 'none' ? !source.groupId : source.groupId === group)) &&
        (!favorites || source.favorite)
    );
  }
  function visible() {
    const list = filtered();
    page = Math.min(page, Math.max(0, Math.ceil(list.length / 25) - 1));
    return list.slice(page * 25, page * 25 + 25);
  }
  function selectionBar() {
    const allFavorites =
      selected.size > 0 && [...selected].every(id => state().config.sources.find(source => source.id === id)?.favorite);
    return `<div class="source-selection"${selected.size ? '' : ' hidden'}><strong>${selected.size} ${t('ausgewählt', 'selected')}</strong><div class="source-selection-actions">${button(t('Gemeinsam bearbeiten', 'Edit together'), 'sources-bulk', 'edit', 'secondary', locked())}<select id="source-selection-group" aria-label="${t('Ausgewählte Quellen gruppieren', 'Group selected sources')}">${options(null, true, t('Gruppe zuordnen …', 'Assign group …'))}</select>${button(allFavorites ? t('Favoriten entfernen', 'Unmark favorites') : t('Favoriten setzen', 'Mark favorites'), 'sources-favorite', '', 'secondary', Boolean(state().operation))}<button class="icon-button" data-action="sources-clear" aria-label="${t('Auswahl aufheben', 'Clear selection')}">×</button></div></div>`;
  }
  function rows() {
    for (const id of selected) if (!state().config.sources.some(source => source.id === id)) selected.delete(id);
    const list = visible(),
      all = filtered(),
      disabled = locked();
    if (!all.length)
      return `<div class="empty-state compact"><h3>${t('Keine passenden Quellen', 'No matching sources')}</h3><p>${t('Passe Suche, Gruppe oder Favoritenfilter an.', 'Adjust the search, group or favorites filter.')}</p>${button(t('Filter zurücksetzen', 'Reset filters'), 'sources-reset', '', 'secondary')}</div>`;
    return `<div class="table-wrap"><table class="table source-table"><thead><tr><th class="selection-column"><input type="checkbox" id="sources-select-page" aria-label="${t('Alle Quellen dieser Seite auswählen', 'Select every source on this page')}"${list.every(source => selected.has(source.id)) ? ' checked' : ''}></th><th>${t('QUELLE', 'SOURCE')}</th><th>${t('SPEICHERORTE', 'DESTINATIONS')}</th><th>${t('AKTIV', 'ENABLED')}</th><th>${t('AKTIONEN', 'ACTIONS')}</th></tr></thead><tbody>${list.map(source => `<tr data-workspace-source="${esc(source.id)}"><td><input type="checkbox" data-source-select="${esc(source.id)}" aria-label="${esc(source.value)} ${t('auswählen', 'select')}"${selected.has(source.id) ? ' checked' : ''}></td><td><div class="source-title"><button type="button" class="icon-button favorite-button${source.favorite ? ' is-favorite' : ''}" data-source-favorite="${esc(source.id)}" aria-pressed="${source.favorite ? 'true' : 'false'}" aria-label="${esc(source.value)} ${t('als Favorit markieren', 'mark as favorite')}"${state().operation ? ' disabled' : ''}>${star(source.favorite)}</button><div><div class="repo-name">${esc(source.value)}</div>${studio.sourceBadge(source)}${source.groupId ? `<span class="label neutral source-group-badge">${esc(groups().find(item => item.id === source.groupId)?.name)}</span>` : ''}<div class="repo-detail">${source.kind === 'owner' ? t('Sammelquelle · neue Repositories automatisch', 'Owner source · new repositories automatically') : t('Einzelnes Repository', 'Individual repository')} · ${esc(state().accounts.find(account => account.id === source.accountId)?.label || 'Standard')}</div>${source.schedule || source.backup ? enhancements.sourceDetails(source) : ''}</div></div></td><td><div class="repo-detail destination-path">${esc(source.destination)}</div>${source.additionalDestinations.map(target => `<div class="repo-detail destination-path">+ ${esc(target.destination)}</div>`).join('')}</td><td>${toggle('source-enabled', source.enabled, `${source.value} ${t('aktivieren', 'enabled')}`, `data-source-toggle="${esc(source.id)}" ${disabled ? 'disabled' : ''}`)}</td><td><div class="actions">${source.kind === 'owner' ? `<button class="icon-button" data-browse-owner="${esc(source.id)}" aria-label="${t('Repositories anzeigen', 'Show repositories')}">${icon('branch')}</button>` : ''}<button class="icon-button" data-open-source="${esc(source.id)}" aria-label="${t('Zielordner öffnen', 'Open destination')}">${icon('folder')}</button><button class="icon-button" data-recommend-source="${esc(source.id)}" aria-label="${t('Umfang empfehlen', 'Recommend content')}"${disabled ? ' disabled' : ''}>${icon('info')}</button><button class="icon-button" data-edit-source="${esc(source.id)}" aria-label="${esc(source.value)} ${t('bearbeiten', 'edit')}"${disabled ? ' disabled' : ''}>${icon('edit')}</button><button class="icon-button danger" data-remove-source="${esc(source.id)}" aria-label="${esc(source.value)} ${t('entfernen', 'remove')}"${disabled ? ' disabled' : ''}>${icon('trash')}</button></div></td></tr>`).join('')}</tbody></table></div><div class="pagination"><span>${all.length} ${t('Quellen', 'sources')}</span><div>${button('‹', 'sources-previous', '', 'secondary', page === 0)}<span>${page + 1} / ${Math.ceil(all.length / 25)}</span>${button('›', 'sources-next', '', 'secondary', (page + 1) * 25 >= all.length)}</div></div>`;
  }
  function refresh() {
    if (getView() !== 'sources' || !document.getElementById('workspace-source-list')) return;
    document.getElementById('workspace-source-list').innerHTML = rows();
    document.getElementById('source-selection-host').innerHTML = selectionBar();
  }
  function view() {
    if (!groups().some(item => item.id === group) && !['all', 'none'].includes(group)) group = 'all';
    signature = `${state().configRevision}:${state().busy}:${Boolean(state().queue)}:${state().operation}`;
    const tools = `<div class="source-toolbar"><input id="source-search" type="search" value="${esc(search)}" placeholder="${t('Quelle oder Speicherort suchen …', 'Search source or destination …')}" aria-label="${t('Quellen durchsuchen', 'Search sources')}"><select id="source-group-filter" aria-label="${t('Nach Gruppe filtern', 'Filter by group')}"><option value="all">${t('Alle Gruppen', 'All groups')}</option><option value="none"${group === 'none' ? ' selected' : ''}>${t('Ohne Gruppe', 'No group')}</option>${groups()
      .map(item => `<option value="${esc(item.id)}"${item.id === group ? ' selected' : ''}>${esc(item.name)}</option>`)
      .join(
        ''
      )}</select><button type="button" class="button secondary favorites-filter" data-action="sources-favorites-filter" aria-pressed="${favorites}">${star(favorites)}${t('Favoriten', 'Favorites')}</button></div>`;
    return (
      heading(
        t('Deine Quellen.', 'Your sources.'),
        t('Auswählen, ordnen und gemeinsam verwalten.', 'Choose, organize and manage together.'),
        button(t('Repositories auswählen', 'Choose repositories'), 'repository-browser', 'branch', 'secondary') +
          button(t('Quelle hinzufügen', 'Add source'), 'add-source', 'plus', 'primary', locked())
      ) +
      `<div id="workspace-drive-recovery">${enhancements.recoveryNotice()}</div>` +
      panel(
        `${icon('folder')} ${t('Verbundene Quellen', 'Connected sources')}`,
        state().config.sources.length
          ? tools +
              `<div id="source-selection-host">${selectionBar()}</div><div id="workspace-source-list">${rows()}</div>`
          : `<div class="empty-state"><div class="empty-illustration">${icon('branch')}</div><h3>${t('Hier beginnt deine Sicherung.', 'Your backup starts here.')}</h3><p>${t('Keine Quellen voreingestellt. Wähle eigene Repositories oder trage eine Quelle ein.', 'No preconfigured sources. Choose your repositories or add a source.')}</p>${button(t('Repositories auswählen', 'Choose repositories'), 'repository-browser', 'branch', 'primary')}</div>`,
        `<div class="actions"><button class="button secondary groups-button" data-action="groups-open" aria-label="${t('Gruppen verwalten', 'Manage groups')}">${icon('folder')}${t('Gruppen', 'Groups')}</button><button class="icon-button" data-action="locate-drives" aria-label="${t('Laufwerke wiederfinden', 'Find drives')}"${state().busy ? ' disabled' : ''}>${icon('folder')}</button>${button(t('Probelauf', 'Dry run'), 'preview-current', '', 'secondary', locked() || !state().config.sources.length)}</div>`
      ) +
      `<div class="info-box">${icon('info')}<p>${t('Einzelne Repository-Regeln haben Vorrang vor Kontoregeln. Gruppen und Favoriten verändern keine Sicherungsdateien.', 'Individual repository rules override account rules. Groups and favorites do not change backup files.')}</p></div>`
    );
  }
  function organizationFields(source) {
    return `<div class="field-grid source-organization">${field(t('Gruppe', 'Group'), 'source-group', `<select id="source-group">${options(source.groupId)}</select>`)}<div class="field"><span class="field-label">${t('Schnellzugriff', 'Quick access')}</span><label class="check-label organization-favorite"><input type="checkbox" id="source-favorite"${source.favorite ? ' checked' : ''}>${t('Als Favorit markieren', 'Mark as favorite')}</label></div></div>`;
  }
  function groupRows() {
    return (
      groups()
        .map(
          item =>
            `<form class="workspace-group-form" data-group-id="${esc(item.id)}"><input value="${esc(item.name)}" maxlength="60" required aria-label="${t('Gruppenname', 'Group name')} ${esc(item.name)}"><span class="repo-detail">${state().config.sources.filter(source => source.groupId === item.id).length} ${t('Quellen', 'sources')}</span><button class="icon-button" type="submit" aria-label="${esc(item.name)} ${t('umbenennen', 'rename')}">${icon('check')}</button><button class="icon-button danger" type="button" data-delete-group="${esc(item.id)}" aria-label="${esc(item.name)} ${t('Gruppe entfernen', 'remove group')}">${icon('trash')}</button></form>`
        )
        .join('') || `<p class="muted">${t('Noch keine Gruppen angelegt.', 'No groups created yet.')}</p>`
    );
  }
  function openGroups() {
    const dialog = document.getElementById('groups-dialog');
    dialog.innerHTML = `<div class="dialog-heading"><h2 id="groups-title">${t('Gruppen verwalten', 'Manage groups')}</h2><button class="icon-button" data-action="groups-close" aria-label="${t('Schließen', 'Close')}">×</button></div><p class="muted">${t('Eigene Namen, bis zu 30 Gruppen. Beim Entfernen einer Gruppe bleiben ihre Quellen erhalten.', 'Your names, up to 30 groups. Removing a group keeps its sources.')}</p><div id="workspace-group-rows">${groupRows()}</div><form id="workspace-new-group"><div class="input-group"><input id="workspace-group-name" maxlength="60" required placeholder="${t('Neue Gruppe', 'New group')}" aria-label="${t('Name der neuen Gruppe', 'New group name')}"><button class="button primary" type="submit">${t('Anlegen', 'Create')}</button></div></form><p id="groups-error" class="form-error" role="alert" hidden></p>`;
    dialog.showModal();
  }
  function showError(id, error) {
    const node = document.getElementById(id);
    if (node) {
      node.textContent = error.message;
      node.hidden = false;
    }
  }
  async function groupMutation(input) {
    const error = document.getElementById('groups-error');
    if (error) error.hidden = true;
    await mutate(() => api.organizeSources(input), t('Organisation gespeichert.', 'Organization saved.'));
    if (document.getElementById('groups-dialog').open)
      document.getElementById('workspace-group-rows').innerHTML = groupRows();
  }

  function browserOrigin() {
    return {
      provider: document.getElementById('browser-provider').value,
      server: document.getElementById('browser-server').value.trim(),
      accountId: document.getElementById('browser-account').value
    };
  }
  function browserMatches() {
    if (!browser) return false;
    try {
      const current = browserOrigin();
      return (
        current.provider === browser.provider &&
        new URL(current.server).href.replace(/\/+$/, '') === browser.server &&
        current.accountId === browser.accountId &&
        document.getElementById('browser-owner').value.trim().toLowerCase() === browser.owner.toLowerCase()
      );
    } catch (_error) {
      return false;
    }
  }
  function syncBrowserProvider(reset = false) {
    const provider = document.getElementById('browser-provider').value,
      server = document.getElementById('browser-server');
    if (reset)
      server.value = provider === 'github' ? 'https://github.com' : provider === 'gitlab' ? 'https://gitlab.com' : '';
    server.readOnly = provider === 'github';
    const account = document.getElementById('browser-account'),
      previous = account.value;
    let canonical = server.value;
    try {
      canonical = new URL(canonical).href.replace(/\/+$/, '');
    } catch (_error) {
      /* Validate on load. */
    }
    account.innerHTML = studio.accountOptions({ provider, server: canonical, accountId: previous });
  }
  const ownerMode = () => Boolean(document.getElementById('browser-auto-owner')?.checked);
  function existingOwner() {
    return (
      browser &&
      state().config.sources.find(
        source =>
          source.kind === 'owner' &&
          source.value.toLowerCase() === browser.owner.toLowerCase() &&
          (source.provider || 'github') === browser.provider &&
          (source.server || 'https://github.com') === browser.server
      )
    );
  }
  function browserCounter() {
    const count = document.getElementById('browser-selected');
    if (!count) return;
    const owner = ownerMode(),
      exists = existingOwner();
    count.textContent =
      browser && !browserMatches()
        ? t('Quelle geändert: Bitte erneut laden.', 'Source changed: Load again.')
        : owner
          ? exists
            ? t(
                'Sammelquelle bereits vorhanden · neue Repositories werden automatisch entdeckt',
                'Owner source already exists · new repositories are discovered automatically'
              )
            : t('Sammelquelle · aktuelle und zukünftige Repositories', 'Owner source · current and future repositories')
          : `${picked.size} ${t('ausgewählt', 'selected')} · ${Math.max(0, 100 - state().config.sources.length - picked.size)} ${t('weitere Quellen möglich', 'more sources available')}`;
    const add = document.getElementById('browser-add');
    add.textContent = owner
      ? exists
        ? t('Vorhandene Quelle beibehalten', 'Keep existing source')
        : t('Sammelquelle hinzufügen', 'Add owner source')
      : `${picked.size || ''} ${t('Quellen hinzufügen', 'Add sources')}`.trim();
    add.disabled =
      (owner ? !browser || (state().config.sources.length >= 100 && !exists) : !picked.size) ||
      browserLoading ||
      locked() ||
      !browserMatches();
    document.getElementById('browser-search').disabled = !browser || !browserMatches();
    const missing = document.getElementById('browser-missing');
    if (missing) missing.disabled = owner || !browser || browserLoading || !browserMatches();
  }
  function browserRows() {
    const host = document.getElementById('browser-results');
    if (!host) return;
    host.setAttribute('aria-busy', String(browserLoading));
    if (!browser) {
      host.innerHTML = `<div class="empty-state compact"><div class="empty-illustration">${icon('branch')}</div><h3>${browserLoading ? t('Repositories werden geladen …', 'Loading repositories …') : t('Deine Auswahl beginnt hier.', 'Your selection starts here.')}</h3><p>${t('Anbieter, Konto und Kontonamen oder Organisation angeben. Es wird noch nichts geklont.', 'Choose a provider, credentials and owner or organization. Nothing is cloned yet.')}</p></div>`;
      browserCounter();
      return;
    }
    const owner = ownerMode(),
      eligible = browser.repositories.filter(item => !item.existing),
      all = owner || (eligible.length > 0 && eligible.every(item => picked.has(item.value.toLowerCase())));
    host.innerHTML = `${browser.limited ? `<p class="inline-warning">${t('Die Suche wurde vom Anbieter begrenzt. Bitte den Suchbegriff präzisieren.', 'The provider limited this search. Please narrow the search term.')}</p>` : ''}${browser.repositories.length ? `<div class="table-wrap browser-table-wrap"><table class="table"><thead><tr><th class="selection-column"><input id="browser-select-page" type="checkbox" aria-label="${t('Repositories dieser Seite auswählen', 'Select repositories on this page')}"${all ? ' checked' : ''}${eligible.length && !owner ? '' : ' disabled'}></th><th>REPOSITORY</th><th>${t('SICHTBARKEIT', 'VISIBILITY')}</th></tr></thead><tbody>${browser.repositories.map(item => `<tr><td><input type="checkbox" data-browser-select="${esc(item.value)}" aria-label="${esc(item.value)} ${t('auswählen', 'select')}"${(owner ? item.existingEnabled !== false : picked.has(item.value.toLowerCase())) ? ' checked' : ''}${item.existing || owner ? ' disabled' : ''}></td><td><div class="repo-name">${esc(item.value)}</div><div class="repo-detail browser-description">${esc(item.description)}</div><div class="browser-badges">${item.fork ? '<span class="label neutral">Fork</span>' : ''}${item.archived ? `<span class="label neutral">${t('Archiviert', 'Archived')}</span>` : ''}${item.existing ? `<span class="label">${item.existingEnabled === false ? t('Einzelregel pausiert', 'Individual rule paused') : t('Bereits eingetragen', 'Already added')}</span>` : ''}</div></td><td><span class="label neutral">${item.private ? t('Privat', 'Private') : t('Öffentlich', 'Public')}</span></td></tr>`).join('')}</tbody></table></div>` : `<div class="empty-state compact"><h3>${t('Keine passenden Repositories', 'No matching repositories')}</h3><p>${t('Suchbegriff oder Zugriffsrechte prüfen.', 'Check your search term or access permissions.')}</p></div>`}<div class="pagination"><span>${t('Seite', 'Page')} ${browser.page}${browser.total == null ? '' : ` · ${browser.total} ${t('Treffer', 'matches')}`}${browserLoading ? ` · ${t('Lädt …', 'Loading …')}` : ''}</span><div>${button('‹', 'browser-previous', '', 'secondary', browser.page === 1 || browserLoading)}${button('›', 'browser-next', '', 'secondary', !browser.hasMore || browserLoading)}</div></div>`;
    browserCounter();
  }
  function openBrowser({ seed = {}, autoOwner = false, autoload = false, template = {} } = {}) {
    browser = null;
    picked.clear();
    browserLoading = false;
    browserSequence++;
    browserTemplate = structuredClone(template);
    const dialog = document.getElementById('repository-browser-dialog');
    dialog.innerHTML = `<div class="dialog-heading"><div><span class="eyebrow">GIT CLONER</span><h2 id="repository-browser-title">${t('Repositories auswählen', 'Choose repositories')}</h2></div><button class="icon-button" data-action="browser-close" aria-label="${t('Schließen', 'Close')}">×</button></div><p class="muted">${t('Gezielt auswählen. Einen gemeinsamen Speicherort festlegen. Später bleibt jede Quelle einzeln anpassbar.', 'Choose what to back up and set a shared destination. Each source can be edited separately later.')}</p><form id="repository-browser-form"><div class="field-grid">${field(t('Anbieter', 'Provider'), 'browser-provider', '<select id="browser-provider"><option value="github">GitHub</option><option value="gitlab">GitLab</option><option value="forgejo">Forgejo</option></select>')}${field(t('Server', 'Server'), 'browser-server', '<input id="browser-server" type="url" required value="https://github.com" readonly>')}${field(t('Zugangsdaten', 'Credentials'), 'browser-account', `<select id="browser-account">${studio.accountOptions({})}</select>`)}${field(t('Konto / Organisation / Gruppe', 'Owner / organization / group'), 'browser-owner', `<div class="input-group"><input id="browser-owner" required spellcheck="false" autocomplete="off" placeholder="${t('Eigenen Namen eingeben', 'Enter an owner name')}"><button class="button secondary" id="browser-load" type="submit">${t('Laden', 'Load')}</button></div>`)}</div></form><div class="browser-owner-mode"><label class="check-label"><input id="browser-auto-owner" type="checkbox"${autoOwner ? ' checked' : ''}>${t('Neue Repositories automatisch mit aufnehmen', 'Automatically include new repositories')}</label><p class="field-help">${t('Als Sammelquelle werden alle passenden Repositories bei jeder Prüfung ermittelt. Einzelregeln haben Vorrang. Für eine feste Auswahl den Haken entfernen.', 'An owner source discovers all matching repositories on every check. Individual rules take priority. Uncheck for a fixed selection.')}</p></div><div class="browser-search-row"><input id="browser-search" type="search" placeholder="${t('Repositories beim Anbieter suchen …', 'Search repositories on the provider …')}" aria-label="${t('Repositories suchen', 'Search repositories')}" disabled><button type="button" class="button secondary" id="browser-missing" data-action="browser-missing" disabled>${t('Alle fehlenden auswählen', 'Select all missing')}</button></div><p id="browser-selected" class="repo-detail" role="status"></p><div id="browser-results" class="browser-results"></div><div class="browser-destination"><div class="field-grid">${field(t('Gemeinsamer Zielordner', 'Shared destination'), 'browser-destination', `<div class="input-group"><input id="browser-destination" placeholder="${t('Vorhandenen Ordner auswählen', 'Choose an existing folder')}"><button class="button secondary" type="button" data-action="browser-directory">${t('Durchsuchen', 'Browse')}</button></div>`)}${field(t('Gruppe für die Auswahl', 'Group for this selection'), 'browser-group', `<select id="browser-group">${options(null)}</select>`)}</div><label class="check-label"><input id="browser-favorite" type="checkbox">${t('Auswahl als Favoriten markieren', 'Mark selection as favorites')}</label></div><p id="browser-error" class="form-error" role="alert" hidden></p><div class="dialog-actions"><button class="button secondary" data-action="browser-close">${t('Abbrechen', 'Cancel')}</button><button class="button primary" id="browser-add" data-action="browser-add" disabled>${t('Quellen hinzufügen', 'Add sources')}</button></div>`;
    document.getElementById('browser-provider').value = seed.provider || 'github';
    document.getElementById('browser-server').value = seed.server || 'https://github.com';
    syncBrowserProvider();
    document.getElementById('browser-account').value = seed.accountId || 'default';
    document.getElementById('browser-owner').value = seed.value || '';
    document.getElementById('browser-destination').value = seed.destination || '';
    document.getElementById('browser-group').value = seed.groupId || '';
    document.getElementById('browser-favorite').checked = Boolean(seed.favorite);
    browserRows();
    dialog.showModal();
    document.getElementById('browser-owner').focus();
    if (autoload) void loadBrowser(true);
  }
  async function loadBrowser(fresh = false, targetPage = 1) {
    const sequence = ++browserSequence;
    browserLoading = true;
    document.getElementById('browser-error').hidden = true;
    if (fresh) {
      try {
        const normalized = window.gitClonerNormalizeSource(document.getElementById('browser-owner').value, {
          ...browserOrigin(),
          kind: 'owner'
        });
        document.getElementById('browser-owner').value = normalized.value;
        if (normalized.ownerPage) document.getElementById('browser-auto-owner').checked = true;
      } catch (error) {
        browserLoading = false;
        showError('browser-error', error);
        browserCounter();
        return;
      }
      browser = null;
      picked.clear();
      document.getElementById('browser-search').value = '';
    }
    browserRows();
    document.getElementById('browser-load').disabled = true;
    try {
      const result = fresh
        ? await api.browseRepositories({
            ...browserOrigin(),
            owner: document.getElementById('browser-owner').value.trim()
          })
        : await api.repositoryPage({
            sessionId: browser.sessionId,
            page: targetPage,
            query: document.getElementById('browser-search').value
          });
      if (sequence !== browserSequence || !document.getElementById('repository-browser-dialog').open) return;
      browser = result;
    } catch (error) {
      if (sequence === browserSequence && error.name !== 'AbortError') showError('browser-error', error);
    } finally {
      if (sequence === browserSequence) {
        browserLoading = false;
        document.getElementById('browser-load').disabled = false;
        browserRows();
      }
    }
  }
  function browserPick(item, checked) {
    const key = item.value.toLowerCase();
    if (checked && !picked.has(key) && picked.size >= 100 - state().config.sources.length)
      throw new Error(
        t('Maximal 100 Quellen. Bitte die Auswahl verkleinern.', 'At most 100 sources. Reduce the selection.')
      );
    if (checked) picked.set(key, item);
    else picked.delete(key);
  }
  async function selectMissing() {
    const sequence = ++browserSequence;
    browserLoading = true;
    document.getElementById('browser-error').hidden = true;
    browserCounter();
    try {
      const result = await api.missingRepositories({ sessionId: browser.sessionId, template: browserTemplate });
      if (sequence !== browserSequence || !document.getElementById('repository-browser-dialog').open) return;
      browser = result;
      document.getElementById('browser-search').value = '';
      picked.clear();
      if (result.coveredByOwner)
        throw new Error(
          t(
            'Diese Sammelquelle ist bereits vorhanden und entdeckt neue Repositories automatisch. Einzelne Ausnahmen können manuell ausgewählt werden.',
            'This owner source already exists and discovers new repositories automatically. Select individual exceptions manually.'
          )
        );
      if (result.overflow)
        throw new Error(
          t(
            'Die fehlenden Repositories überschreiten die Grenze von 100 Quellen. Aktiviere die Sammelquelle oder wähle einzelne Projekte.',
            'The missing repositories exceed the limit of 100 sources. Enable the owner source or choose individual projects.'
          )
        );
      for (const item of result.selection) picked.set(item.value.toLowerCase(), item);
    } catch (error) {
      if (sequence === browserSequence && error.name !== 'AbortError') showError('browser-error', error);
    } finally {
      if (sequence === browserSequence) {
        browserLoading = false;
        browserRows();
      }
    }
  }
  async function addBrowser() {
    const add = document.getElementById('browser-add');
    add.disabled = true;
    try {
      const result = await mutate(
        () =>
          api.addRepositories({
            sessionId: browser.sessionId,
            asOwner: ownerMode(),
            template: browserTemplate,
            repositories: [...picked.values()].map(item => item.value),
            destination: document.getElementById('browser-destination').value.trim(),
            groupId: document.getElementById('browser-group').value || null,
            favorite: document.getElementById('browser-favorite').checked
          }),
        t('Ausgewählte Quellen gespeichert.', 'Selected sources saved.')
      );
      document.getElementById('repository-browser-dialog').close();
      toast(
        `${result.added} ${t('Quellen hinzugefügt', 'sources added')}${result.skipped ? ` · ${result.skipped} ${t('bereits vorhanden', 'already present')}` : ''}`
      );
    } catch (error) {
      showError('browser-error', error);
    } finally {
      browserCounter();
    }
  }
  const choice = (id, values) =>
    `<select id="${id}"><option value="keep">${t('Unverändert lassen', 'Keep unchanged')}</option>${values.map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select>`;
  const booleanChoice = id =>
    choice(id, [
      ['true', t('Ein', 'On')],
      ['false', t('Aus', 'Off')]
    ]);
  function bulkScheduleTimes(count = 1, start = '02:00') {
    const [hours, minutes] = start.split(':').map(Number),
      first = hours * 60 + minutes;
    return Array.from({ length: count }, (_, index) => {
      const value = (first + Math.floor((index * 1440) / count)) % 1440;
      return `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;
    });
  }
  function renderBulkTimes(times) {
    document.getElementById('bulk-times').innerHTML = times
      .map((value, index) =>
        field(
          `${t('Prüfung', 'Check')} ${index + 1}`,
          `bulk-time-${index}`,
          `<input type="time" id="bulk-time-${index}" class="bulk-time" value="${esc(value)}" required>`
        )
      )
      .join('');
  }
  function openBulk() {
    bulkIds = [...selected];
    if (!bulkIds.length) return;
    bulkToken = null;
    bulkChanges = [];
    bulkPage = 0;
    const first = state().config.sources.find(source => source.id === bulkIds[0]);
    const providers = new Set(
      state()
        .config.sources.filter(source => selected.has(source.id))
        .map(source => `${source.provider || 'github'}:${source.server || 'https://github.com'}`)
    );
    const compatible =
      providers.size === 1
        ? studio.accountOptions(first).replaceAll(' selected>', '>')
        : `<option value="default">${t('Standard / öffentlich', 'Default / public')}</option>`;
    const dialog = document.getElementById('bulk-sources-dialog');
    dialog.innerHTML = `<div class="dialog-heading"><div><span class="eyebrow">${bulkIds.length} ${t('QUELLEN AUSGEWÄHLT', 'SOURCES SELECTED')}</span><h2 id="bulk-sources-title">${t('Gemeinsam bearbeiten', 'Edit together')}</h2></div><button class="icon-button" data-action="bulk-close" aria-label="${t('Schließen', 'Close')}">×</button></div><p class="muted">${t('Nur ausdrücklich gewählte Felder ändern sich. Alle übrigen Einstellungen bleiben je Quelle erhalten.', 'Only explicitly chosen fields change. Every other setting is preserved for each source.')}</p><form id="bulk-sources-form" novalidate><div id="bulk-fields"><div class="field-grid">${field(t('Gruppe', 'Group'), 'bulk-group', `<select id="bulk-group">${options(null, true)}</select>`)}${field(t('Quellenstatus', 'Source status'), 'bulk-enabled', booleanChoice('bulk-enabled'))}${field(t('Favorit', 'Favorite'), 'bulk-favorite', booleanChoice('bulk-favorite'))}${field(t('Zugangsdaten', 'Credentials'), 'bulk-account', `<select id="bulk-account"><option value="keep">${t('Unverändert lassen', 'Keep unchanged')}</option>${compatible}</select>`)}</div><label class="check-label"><input id="bulk-change-destination" type="checkbox">${t('Gemeinsamen Zielordner ändern', 'Change the shared destination')}</label><div class="input-group bulk-destination"><input id="bulk-destination" disabled placeholder="${t('Vorhandenen Ordner auswählen', 'Choose an existing folder')}" aria-label="${t('Neuer gemeinsamer Zielordner', 'New shared destination')}"><button type="button" class="button secondary" data-action="bulk-directory" id="bulk-directory-button" disabled>${t('Durchsuchen', 'Browse')}</button></div><p class="field-help">${t('Ein Zielwechsel erstellt zukünftige Sicherungen am neuen Ort. Bestehende Sicherungsdateien werden nicht verschoben oder gelöscht.', 'A destination change writes future backups to the new location. Existing backup files are retained at their current location.')}</p><details class="advanced"><summary>${t('Repository-Filter', 'Repository filters')}</summary><div class="advanced-body"><div class="field-grid">${field(t('Forks einschließen', 'Include forks'), 'bulk-forks', booleanChoice('bulk-forks'))}${field(t('Archivierte einschließen', 'Include archived'), 'bulk-archived', booleanChoice('bulk-archived'))}</div><div class="field-grid"><div class="field"><label class="check-label"><input id="bulk-change-include" type="checkbox">${t('Einschlussmuster ersetzen', 'Replace include patterns')}</label><textarea id="bulk-include" rows="3" disabled aria-label="${t('Neue Einschlussmuster', 'New include patterns')}"></textarea></div><div class="field"><label class="check-label"><input id="bulk-change-exclude" type="checkbox">${t('Ausschlussmuster ersetzen', 'Replace exclude patterns')}</label><textarea id="bulk-exclude" rows="3" disabled aria-label="${t('Neue Ausschlussmuster', 'New exclude patterns')}"></textarea></div></div><p class="field-help">${t('Ein Muster pro Zeile. Ein bewusst leeres Feld entfernt die jeweiligen Muster.', 'One pattern per line. An explicitly empty field clears these patterns.')}</p></div></details><details class="advanced"><summary>${t('Sicherungsumfang', 'Backup content')}</summary><div class="advanced-body">${field(
      t('Sicherungsoptionen', 'Backup options'),
      'bulk-backup-mode',
      choice('bulk-backup-mode', [
        ['global', t('Globale Optionen übernehmen', 'Use global options')],
        ['custom', t('Gezielt ändern', 'Change selected options')]
      ])
    )}<div id="bulk-backup-fields" hidden><div class="field-grid">${field(
      t('Git-Modus', 'Git mode'),
      'bulk-git-mode',
      choice('bulk-git-mode', [
        ['snapshot', t('Arbeitskopie', 'Working copy')],
        ['mirror', 'Mirror']
      ])
    )}${field('Git LFS', 'bulk-lfs', booleanChoice('bulk-lfs'))}${field(t('Submodule', 'Submodules'), 'bulk-submodules', booleanChoice('bulk-submodules'))}${field(t('Verschlüsselung', 'Encryption'), 'bulk-encryption', booleanChoice('bulk-encryption'))}${field(
      t('Integritätsprüfung', 'Integrity verification'),
      'bulk-integrity',
      choice('bulk-integrity', [
        ['weekly', t('Wöchentlich', 'Weekly')],
        ['always', t('Bei jeder Prüfung', 'Every check')],
        ['manual', t('Manuell', 'Manual')]
      ])
    )}${field(
      t('Release-Dateien', 'Release assets'),
      'bulk-release-scope',
      choice('bulk-release-scope', [
        ['all', t('Alle Betriebssysteme', 'All operating systems')],
        ['system', t('Nur mein Betriebssystem', 'Only my operating system')]
      ])
    )}${['issues', 'pullRequests', 'releases', 'wiki'].map(key => field({ issues: 'Issues', pullRequests: 'Pull-/Merge-Requests', releases: 'Releases', wiki: 'Wiki' }[key], `bulk-meta-${key}`, booleanChoice(`bulk-meta-${key}`))).join('')}</div></div></div></details><details class="advanced"><summary>${t('Eigene Prüfzeiten', 'Custom check times')}</summary><div class="advanced-body">${field(
      t('Zeitplan', 'Schedule'),
      'bulk-schedule',
      choice('bulk-schedule', [
        ['global', t('Allgemeinen Zeitplan übernehmen', 'Use global schedule')],
        ['custom', t('Eigene tägliche Zeiten', 'Custom daily times')]
      ])
    )}<div id="bulk-schedule-fields" hidden><div class="field-grid">${field(t('Zeitplan aktiv', 'Schedule enabled'), 'bulk-schedule-enabled', `<select id="bulk-schedule-enabled"><option value="true">${t('Ein', 'On')}</option><option value="false">${t('Aus', 'Off')}</option></select>`)}${field(t('Prüfungen pro Tag', 'Checks per day'), 'bulk-checks', `<select id="bulk-checks">${Array.from({ length: 24 }, (_, index) => `<option value="${index + 1}">${index + 1}</option>`).join('')}</select>`)}</div><div class="time-inputs" id="bulk-times"></div></div></div></details></div><div id="bulk-preview" hidden></div><p id="bulk-error" class="form-error" role="alert" hidden></p><div class="dialog-actions"><button class="button secondary" type="button" data-action="bulk-close">${t('Abbrechen', 'Cancel')}</button><button class="button secondary" type="button" id="bulk-back" data-action="bulk-back" hidden>${t('Zurück', 'Back')}</button><button class="button primary" type="submit" id="bulk-preview-button">${t('Änderungen prüfen', 'Review changes')}</button><button class="button primary" type="button" id="bulk-apply" data-action="bulk-apply" hidden disabled>${t('Änderungen übernehmen', 'Apply changes')}</button></div></form>`;
    renderBulkTimes(['02:00']);
    dialog.showModal();
  }
  function readBulkPatch() {
    const patch = {},
      value = id => document.getElementById(id).value;
    for (const [id, key] of [
      ['bulk-enabled', 'enabled'],
      ['bulk-favorite', 'favorite']
    ])
      if (value(id) !== 'keep') patch[key] = value(id) === 'true';
    if (value('bulk-group') !== 'keep') patch.groupId = value('bulk-group') || null;
    if (value('bulk-account') !== 'keep') patch.accountId = value('bulk-account');
    if (document.getElementById('bulk-change-destination').checked)
      patch.destination = value('bulk-destination').trim();
    const filters = {};
    if (value('bulk-forks') !== 'keep') filters.includeForks = value('bulk-forks') === 'true';
    if (value('bulk-archived') !== 'keep') filters.includeArchived = value('bulk-archived') === 'true';
    for (const key of ['include', 'exclude'])
      if (document.getElementById(`bulk-change-${key}`).checked)
        filters[key] = value(`bulk-${key}`)
          .split(/\r?\n/)
          .map(text => text.trim())
          .filter(Boolean);
    if (Object.keys(filters).length) patch.filters = filters;
    if (value('bulk-backup-mode') === 'global') patch.backup = null;
    if (value('bulk-backup-mode') === 'custom') {
      const backup = {};
      for (const [id, key] of [
        ['bulk-git-mode', 'mode'],
        ['bulk-integrity', 'integrity'],
        ['bulk-release-scope', 'releaseScope']
      ])
        if (value(id) !== 'keep') backup[key] = value(id);
      for (const key of ['lfs', 'submodules', 'encryption'])
        if (value(`bulk-${key}`) !== 'keep') backup[key] = value(`bulk-${key}`) === 'true';
      const metadata = {};
      for (const key of ['issues', 'pullRequests', 'releases', 'wiki'])
        if (value(`bulk-meta-${key}`) !== 'keep') metadata[key] = value(`bulk-meta-${key}`) === 'true';
      if (Object.keys(metadata).length) backup.metadata = metadata;
      if (Object.keys(backup).length) patch.backup = backup;
    }
    if (value('bulk-schedule') === 'global') patch.schedule = null;
    if (value('bulk-schedule') === 'custom')
      patch.schedule = {
        enabled: value('bulk-schedule-enabled') === 'true',
        checksPerDay: Number(value('bulk-checks')),
        times: [...document.querySelectorAll('.bulk-time')].map(node => node.value)
      };
    if (!Object.keys(patch).length)
      throw new Error(t('Bitte mindestens eine Änderung auswählen.', 'Choose at least one change.'));
    return patch;
  }
  function describe(fieldName, value) {
    if (fieldName === 'groupId') return groups().find(item => item.id === value)?.name || t('Ohne Gruppe', 'No group');
    if (fieldName === 'enabled' || fieldName === 'favorite') return value ? t('Ein', 'On') : t('Aus', 'Off');
    if (fieldName === 'accountId') return state().accounts.find(item => item.id === value)?.label || value;
    if (fieldName === 'destination') return value;
    if (fieldName === 'schedule')
      return value
        ? `${value.enabled ? t('Aktiv', 'Enabled') : t('Pausiert', 'Paused')} · ${value.times.join(', ')}`
        : t('Allgemeiner Zeitplan', 'Global schedule');
    if (fieldName === 'backup')
      return value
        ? `${value.mode === 'mirror' ? 'Mirror' : t('Arbeitskopie', 'Working copy')} · LFS ${value.lfs ? t('ein', 'on') : t('aus', 'off')} · ${t('Submodule', 'Submodules')} ${value.submodules ? t('ein', 'on') : t('aus', 'off')} · ${t('Verschlüsselung', 'Encryption')} ${value.encryption ? t('ein', 'on') : t('aus', 'off')} · ${t('Integrität', 'Integrity')}: ${{ weekly: t('wöchentlich', 'weekly'), always: t('immer', 'always'), manual: t('manuell', 'manual') }[value.integrity]} · ${
            Object.entries(value.metadata)
              .filter(([, enabled]) => enabled)
              .map(([key]) => ({ issues: 'Issues', pullRequests: 'PR/MR', releases: 'Releases', wiki: 'Wiki' })[key])
              .join(', ') || t('Keine Metadaten', 'No metadata')
          } · ${value.releaseScope === 'system' ? t('Releases: eigenes OS', 'Releases: own OS') : t('Releases: alle OS', 'Releases: all OS')}`
        : t('Globale Sicherungsoptionen', 'Global backup options');
    if (fieldName === 'filters')
      return `${t('Forks', 'Forks')}: ${value.includeForks ? t('ein', 'on') : t('aus', 'off')} · ${t('Archivierte', 'Archived')}: ${value.includeArchived ? t('ein', 'on') : t('aus', 'off')} · ${t('Einschluss', 'Include')}: ${value.include.join(', ') || t('alle', 'all')} · ${t('Ausschluss', 'Exclude')}: ${value.exclude.join(', ') || '—'}`;
    return String(value ?? '—');
  }
  function renderBulkPreview() {
    const names = {
      groupId: t('Gruppe', 'Group'),
      enabled: t('Aktiv', 'Enabled'),
      favorite: t('Favorit', 'Favorite'),
      accountId: t('Zugangsdaten', 'Credentials'),
      destination: t('Zielordner', 'Destination'),
      backup: t('Sicherungsumfang', 'Backup content'),
      schedule: t('Zeitplan', 'Schedule'),
      filters: t('Filter', 'Filters')
    };
    document.getElementById('bulk-preview').innerHTML =
      `<div class="info-box">${icon('check')}<p><strong>${bulkChanges.length} ${t('Quellen mit Änderungen', 'sources with changes')}</strong><br>${t('Prüfe die Unterschiede vor dem gemeinsamen Speichern.', 'Review the differences before saving them together.')}</p></div>${bulkChanges
        .slice(bulkPage * 10, bulkPage * 10 + 10)
        .map(
          source =>
            `<section class="bulk-preview-card"><h3>${esc(source.value)}</h3>${source.fields.map(item => `<div class="bulk-preview-field"><strong>${names[item.field]}</strong><div class="field-grid"><div><span class="repo-detail">${t('Bisher', 'Before')}</span><p>${esc(describe(item.field, item.before))}</p></div><div><span class="repo-detail">${t('Danach', 'After')}</span><p>${esc(describe(item.field, item.after))}</p></div></div></div>`).join('')}</section>`
        )
        .join(
          ''
        )}<div class="pagination"><span>${bulkChanges.length ? bulkPage + 1 : 0} / ${Math.ceil(bulkChanges.length / 10)}</span><div>${button('‹', 'bulk-previous', '', 'secondary', !bulkPage)}${button('›', 'bulk-next', '', 'secondary', (bulkPage + 1) * 10 >= bulkChanges.length)}</div></div>`;
  }
  async function previewBulk() {
    document.getElementById('bulk-error').hidden = true;
    const submit = document.getElementById('bulk-preview-button');
    submit.disabled = true;
    try {
      const result = await api.previewSources({ ids: bulkIds, patch: readBulkPatch() });
      bulkToken = result.token;
      bulkChanges = result.changes;
      bulkPage = 0;
      renderBulkPreview();
      document.getElementById('bulk-fields').hidden = true;
      document.getElementById('bulk-preview').hidden = false;
      submit.hidden = true;
      document.getElementById('bulk-back').hidden = false;
      document.getElementById('bulk-apply').hidden = false;
      update();
    } catch (error) {
      showError('bulk-error', error);
    } finally {
      submit.disabled = false;
    }
  }
  async function applyBulk() {
    const apply = document.getElementById('bulk-apply');
    apply.disabled = true;
    try {
      await mutate(
        () => api.applySources({ token: bulkToken }),
        t('Gemeinsame Änderungen gespeichert.', 'Changes saved together.')
      );
      document.getElementById('bulk-sources-dialog').close();
      selected.clear();
      refresh();
    } catch (error) {
      showError('bulk-error', error);
      update();
    }
  }

  function update() {
    const accounts = JSON.stringify(state().accounts);
    if (accounts !== accountsSignature) {
      accountsSignature = accounts;
      if (document.getElementById('repository-browser-dialog')?.open) syncBrowserProvider();
    }
    const recovery = document.getElementById('workspace-drive-recovery'),
      markup = enhancements.recoveryNotice();
    if (recovery && recovery.innerHTML !== markup) recovery.innerHTML = markup;
    const next = `${state().configRevision}:${state().busy}:${Boolean(state().queue)}:${state().operation}`;
    if (next !== signature && getView() === 'sources') {
      signature = next;
      if (document.getElementById('workspace-source-list')) {
        const filter = document.getElementById('source-group-filter');
        if (!groups().some(item => item.id === group) && !['all', 'none'].includes(group)) group = 'all';
        filter.innerHTML = `<option value="all">${t('Alle Gruppen', 'All groups')}</option><option value="none">${t('Ohne Gruppe', 'No group')}</option>${groups()
          .map(item => `<option value="${esc(item.id)}">${esc(item.name)}</option>`)
          .join('')}`;
        filter.value = group;
        refresh();
      }
      for (const node of document.querySelectorAll(
        '#main-content [data-action="add-source"],#main-content [data-action="preview-current"]'
      ))
        node.disabled = locked();
    }
    const apply = document.getElementById('bulk-apply');
    if (apply) apply.disabled = locked() || !bulkToken || !bulkChanges.length;
    if (document.getElementById('browser-add')) browserCounter();
  }
  function bind() {
    document.addEventListener('input', event => {
      if (event.target.id === 'source-search') {
        search = event.target.value;
        page = 0;
        refresh();
      }
      if (event.target.id === 'browser-search' && browser) {
        clearTimeout(browserTimer);
        browserLoading = true;
        browserCounter();
        browserTimer = setTimeout(() => void loadBrowser(false, 1), 280);
      }
      if (event.target.id === 'browser-server') syncBrowserProvider();
      if (['browser-server', 'browser-owner'].includes(event.target.id)) browserCounter();
    });
    document.addEventListener('change', event => {
      const node = event.target;
      if (node.id === 'source-group-filter') {
        group = node.value;
        page = 0;
        refresh();
      }
      if (node.id === 'source-group') getSourceDraft().groupId = node.value || null;
      if (node.id === 'source-favorite') getSourceDraft().favorite = node.checked;
      if (node.dataset.sourceSelect) {
        if (node.checked) selected.add(node.dataset.sourceSelect);
        else selected.delete(node.dataset.sourceSelect);
        refresh();
      }
      if (node.id === 'sources-select-page') {
        for (const source of visible()) {
          if (node.checked) selected.add(source.id);
          else selected.delete(source.id);
        }
        refresh();
      }
      if (node.id === 'source-selection-group' && node.value !== 'keep')
        void attempt(() => groupMutation({ ids: [...selected], groupId: node.value || null }));
      if (node.id === 'browser-provider') {
        syncBrowserProvider(true);
        browserCounter();
      }
      if (node.id === 'browser-account') browserCounter();
      if (node.id === 'browser-auto-owner') {
        browserRows();
        if (!node.checked && browser && !picked.size) void selectMissing();
      }
      if (node.id === 'bulk-change-destination') {
        document.getElementById('bulk-destination').disabled = !node.checked;
        document.getElementById('bulk-directory-button').disabled = !node.checked;
      }
      for (const key of ['include', 'exclude'])
        if (node.id === `bulk-change-${key}`) document.getElementById(`bulk-${key}`).disabled = !node.checked;
      if (node.id === 'bulk-backup-mode')
        document.getElementById('bulk-backup-fields').hidden = node.value !== 'custom';
      if (node.id === 'bulk-schedule') document.getElementById('bulk-schedule-fields').hidden = node.value !== 'custom';
      if (node.id === 'bulk-checks')
        renderBulkTimes(bulkScheduleTimes(Number(node.value), document.querySelector('.bulk-time')?.value || '02:00'));
      if (node.dataset.browserSelect && browser) {
        try {
          browserPick(
            browser.repositories.find(item => item.value === node.dataset.browserSelect),
            node.checked
          );
        } catch (error) {
          node.checked = false;
          showError('browser-error', error);
        }
        browserRows();
      }
      if (node.id === 'browser-select-page' && browser) {
        const entries = browser.repositories.filter(item => !item.existing);
        if (
          node.checked &&
          new Set([...picked.keys(), ...entries.map(item => item.value.toLowerCase())]).size >
            100 - state().config.sources.length
        ) {
          node.checked = false;
          showError(
            'browser-error',
            new Error(
              t(
                'Die gesamte Seite überschreitet die Grenze von 100 Quellen.',
                'Selecting this page would exceed the limit of 100 sources.'
              )
            )
          );
        } else for (const item of entries) browserPick(item, node.checked);
        browserRows();
      }
    });
    document.addEventListener('click', event => {
      const node = event.target.closest('button');
      if (!node || node.disabled) return;
      if (node.dataset.browseOwner) {
        const seed = state().config.sources.find(source => source.id === node.dataset.browseOwner);
        openBrowser({ seed, template: seed, autoOwner: true, autoload: true });
        return;
      }
      if (node.dataset.sourceFavorite) {
        const id = node.dataset.sourceFavorite;
        void attempt(() =>
          mutate(
            () =>
              api.organizeSources({
                ids: [id],
                favorite: !state().config.sources.find(source => source.id === id)?.favorite
              }),
            t('Favorit aktualisiert.', 'Favorite updated.')
          )
        );
        return;
      }
      if (node.dataset.deleteGroup) {
        void groupMutation({ group: { id: node.dataset.deleteGroup, remove: true } }).catch(error =>
          showError('groups-error', error)
        );
        return;
      }
      const actions = {
        'sources-reset': () => {
          search = '';
          group = 'all';
          favorites = false;
          page = 0;
          document.getElementById('source-search').value = '';
          document.getElementById('source-group-filter').value = 'all';
          document.querySelector('.favorites-filter').setAttribute('aria-pressed', 'false');
          refresh();
        },
        'sources-favorites-filter': () => {
          favorites = !favorites;
          page = 0;
          node.setAttribute('aria-pressed', String(favorites));
          node.innerHTML = star(favorites) + t('Favoriten', 'Favorites');
          refresh();
        },
        'sources-next': () => {
          page++;
          refresh();
        },
        'sources-previous': () => {
          page--;
          refresh();
        },
        'sources-clear': () => {
          selected.clear();
          refresh();
        },
        'sources-favorite': () =>
          groupMutation({
            ids: [...selected],
            favorite: ![...selected].every(id => state().config.sources.find(source => source.id === id)?.favorite)
          }),
        'groups-open': openGroups,
        'groups-close': () => document.getElementById('groups-dialog').close(),
        'repository-browser': openBrowser,
        'browser-close': () => document.getElementById('repository-browser-dialog').close(),
        'browser-directory': async () => {
          const folder = await api.chooseDirectory();
          if (folder) document.getElementById('browser-destination').value = folder;
        },
        'browser-next': () => loadBrowser(false, browser.page + 1),
        'browser-previous': () => loadBrowser(false, browser.page - 1),
        'browser-add': addBrowser,
        'browser-missing': selectMissing,
        'sources-bulk': openBulk,
        'bulk-close': () => document.getElementById('bulk-sources-dialog').close(),
        'bulk-directory': async () => {
          const folder = await api.chooseDirectory();
          if (folder) document.getElementById('bulk-destination').value = folder;
        },
        'bulk-back': () => {
          bulkToken = null;
          document.getElementById('bulk-fields').hidden = false;
          document.getElementById('bulk-preview').hidden = true;
          document.getElementById('bulk-preview-button').hidden = false;
          document.getElementById('bulk-back').hidden = true;
          document.getElementById('bulk-apply').hidden = true;
        },
        'bulk-previous': () => {
          bulkPage--;
          renderBulkPreview();
        },
        'bulk-next': () => {
          bulkPage++;
          renderBulkPreview();
        },
        'bulk-apply': applyBulk
      };
      if (actions[node.dataset.action]) void attempt(actions[node.dataset.action]);
    });
    document.addEventListener('submit', event => {
      const form = event.target;
      if (form.id === 'workspace-new-group') {
        event.preventDefault();
        void groupMutation({
          group: { id: crypto.randomUUID(), name: document.getElementById('workspace-group-name').value }
        })
          .then(() => {
            document.getElementById('workspace-group-name').value = '';
          })
          .catch(error => showError('groups-error', error));
      }
      if (form.classList.contains('workspace-group-form')) {
        event.preventDefault();
        void groupMutation({ group: { id: form.dataset.groupId, name: form.querySelector('input').value } }).catch(
          error => showError('groups-error', error)
        );
      }
      if (form.id === 'repository-browser-form') {
        event.preventDefault();
        clearTimeout(browserTimer);
        void loadBrowser(true);
      }
      if (form.id === 'bulk-sources-form') {
        event.preventDefault();
        void previewBulk();
      }
    });
    document.getElementById('repository-browser-dialog').addEventListener('close', () => {
      browserSequence++;
      browserLoading = false;
      clearTimeout(browserTimer);
      void api.closeRepositoryBrowser();
    });
  }
  return { view, update, bind, organizationFields, openBrowser };
};
