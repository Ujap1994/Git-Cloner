const { test } = require('node:test');
const assert = require('node:assert/strict');
const { defaults, validateConfig } = require('../../app/core/config.cjs');
const { TransferBudget, windowActive } = require('../../app/core/transport.cjs');
const { observeRate, budgetError, budgetView } = require('../../app/core/rate-limit.cjs');
const { latestFromWeb, checkForUpdates } = require('../../app/core/updates.cjs');
const {
  backupNotification,
  programNotification,
  reminderNotification
} = require('../../app/core/notification-text.cjs');
const { GitHubClient } = require('../../app/core/github.cjs');

test('new settings have safe defaults, migrate older files and reject invalid values', () => {
  const config = validateConfig(defaults());
  assert.deepEqual(config.programUpdates, { mode: 'after-exit' });
  assert.deepEqual(config.execution.pauseReminder, { action: 'remind', hours: 24 });
  assert.deepEqual(config.execution.bandwidthWindow, { enabled: false, from: '08:00', to: '18:00', kbps: 1024 });
  assert.equal(config.notificationRules.programs, true);
  const older = defaults();
  delete older.programUpdates;
  delete older.execution.pauseReminder;
  delete older.execution.bandwidthWindow;
  delete older.notificationRules.programs;
  assert.deepEqual(validateConfig(older).execution, config.execution);
  const invalid = [
    c => (c.programUpdates.mode = 'force'),
    c => (c.execution.pauseReminder = { action: 'later', hours: 24 }),
    c => (c.execution.pauseReminder.hours = 0),
    c => (c.execution.bandwidthWindow = { enabled: true, from: '08:00', to: '08:00', kbps: 10 }),
    c => (c.execution.bandwidthWindow.from = '25:00'),
    c => (c.execution.bandwidthWindow.kbps = 0),
    c => (c.notificationRules.programs = 'yes')
  ];
  for (const change of invalid) {
    const value = defaults();
    change(value);
    assert.throws(() => validateConfig(value));
  }
});

test('the bandwidth window applies its own limit during the day and across midnight', () => {
  const at = time => new Date(2026, 10, 7, ...time.split(':').map(Number));
  const day = { enabled: true, from: '08:00', to: '18:00', bytesPerSecond: 1024 };
  assert.equal(windowActive(day, at('07:59')), false);
  assert.equal(windowActive(day, at('08:00')), true);
  assert.equal(windowActive(day, at('17:59')), true);
  assert.equal(windowActive(day, at('18:00')), false);
  const night = { ...day, from: '22:00', to: '06:00' };
  assert.equal(windowActive(night, at('23:30')), true);
  assert.equal(windowActive(night, at('05:59')), true);
  assert.equal(windowActive(night, at('12:00')), false);
  assert.equal(windowActive({ ...day, enabled: false }, at('12:00')), false);
  let clock = at('12:00');
  const budget = new TransferBudget({ bytesPerSecond: 0, window: day, clock: () => clock });
  assert.equal(budget.bytesPerSecond, 1024);
  clock = at('20:00');
  assert.equal(budget.bytesPerSecond, 0);
  assert.equal(budget.slowestBytesPerSecond, 1024);
  assert.equal(new TransferBudget({ bytesPerSecond: 4096 }).slowestBytesPerSecond, 4096);
  assert.equal(new TransferBudget().slowestBytesPerSecond, 0);
});

test('the remaining API quota is read from responses and pauses work shortly before it runs out', () => {
  const now = Date.parse('2026-11-07T18:00:00Z'),
    reset = Math.floor(now / 1000) + 600,
    state = {};
  observeRate(
    state,
    new Headers({
      'x-ratelimit-limit': '60',
      'x-ratelimit-remaining': '5',
      'x-ratelimit-reset': String(reset),
      'x-ratelimit-resource': 'core'
    }),
    now
  );
  assert.deepEqual([state.limit, state.remaining, state.resetAt], [60, 5, new Date(reset * 1000).toISOString()]);
  observeRate(
    state,
    new Headers({ 'x-ratelimit-limit': '10', 'x-ratelimit-remaining': '0', 'x-ratelimit-resource': 'search' }),
    now
  );
  assert.equal(state.remaining, 5);
  observeRate(state, new Headers({ etag: 'x' }), now);
  assert.equal(state.remaining, 5);
  assert.equal(budgetError(state, { reserve: 4, now }), null);
  observeRate(
    state,
    new Headers({ 'ratelimit-limit': '2000', 'ratelimit-remaining': '3', 'ratelimit-reset': '120' }),
    now
  );
  assert.deepEqual([state.limit, state.remaining, state.resetAt], [2000, 3, new Date(now + 120000).toISOString()]);
  const error = budgetError(state, { reserve: 4, label: 'GitLab', now });
  assert.deepEqual(
    [error.rateLimited, error.proactive, error.rateLimitUntil],
    [true, true, new Date(now + 120000).toISOString()]
  );
  assert.match(error.message, /^GitLab-API-Kontingent fast aufgebraucht \(3 von 2000/);
  assert.equal(budgetError(state, { reserve: 4, now: now + 120000 }), null);
  assert.deepEqual(budgetView(state, now), { limit: 2000, remaining: 3, resetAt: state.resetAt });
  assert.deepEqual(budgetView(state, now + 120000), { limit: 2000, remaining: 2000, resetAt: null });
  assert.equal(budgetView({}, now), null);
});

test('transfer-scoped GitHub clients share the observed quota with their account client', async () => {
  const reset = String(Math.floor(Date.now() / 1000) + 600);
  const client = new GitHubClient({
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ 'x-ratelimit-limit': '60', 'x-ratelimit-remaining': '2', 'x-ratelimit-reset': reset }),
      text: async () => '{}'
    })
  });
  await client.withTransfer(null).request('/repos/demo/project');
  assert.equal(client.rateState.remaining, 2);
  assert.equal(client.budgetError(4).rateLimited, true);
});

test('the version check reads the release redirect without an API request and falls back to the API', async () => {
  const redirect = location => async (_url, options) => {
    assert.deepEqual([options.method, options.redirect], ['HEAD', 'manual']);
    return { status: 302, headers: new Headers({ location }) };
  };
  assert.deepEqual(await latestFromWeb(redirect('https://github.com/Ujap1994/Git-Cloner/releases/tag/v3.7.0')), {
    tag_name: 'v3.7.0'
  });
  assert.deepEqual(await latestFromWeb(redirect('https://github.com/Ujap1994/Git-Cloner/releases')), {
    tag_name: null
  });
  await assert.rejects(latestFromWeb(redirect('https://example.com/elsewhere')));
  let apiRequests = 0;
  const github = { request: async () => (apiRequests++, { tag_name: 'v3.6.1' }) };
  const web = await checkForUpdates('3.6.1', github, {
    web: redirect('https://github.com/Ujap1994/Git-Cloner/releases/tag/v3.7.0')
  });
  assert.deepEqual([web.status, web.latestVersion, apiRequests], ['available', '3.7.0', 0]);
  const unpublished = await checkForUpdates('3.6.1', github, {
    web: redirect('https://github.com/Ujap1994/Git-Cloner/releases')
  });
  assert.deepEqual([unpublished.status, apiRequests], ['unpublished', 0]);
  const fallback = await checkForUpdates('3.6.1', github, {
    web: async () => ({ status: 200, headers: new Headers() })
  });
  assert.deepEqual([fallback.status, apiRequests], ['current', 1]);
});

test('notifications name installed, ready and waiting programs and the repositories to review', () => {
  const program = (fullName, installation) => ({ fullName, status: 'unchanged', installation });
  const result = {
    resultCount: 4,
    changedCount: 2,
    errorCount: 1,
    results: [
      program('demo/editor', { status: 'installed', tag: 'v2.0.0', programs: [{ name: 'Editor' }] }),
      program('demo/viewer', { status: 'available', latestTag: 'v1.4.0' }),
      program('demo/player', { status: 'waiting', latestTag: 'v0.9.0' }),
      { fullName: 'demo/broken', status: 'error' }
    ]
  };
  assert.deepEqual(backupNotification(result, 'en'), {
    title: 'Git Cloner · Review backup',
    body: '4 checked · 2 changed · 1 error\nEditor v2.0.0 installed.\nviewer v1.4.0 is ready to install.\n… and 2 more.'
  });
  assert.equal(
    backupNotification({ ...result, errorCount: 0, results: result.results.slice(0, 1) }, 'de').body,
    '4 geprüft · 2 geändert · 0 Fehler\nEditor v2.0.0 installiert.'
  );
  assert.equal(
    programNotification(result.results.slice(2, 3), 'de').body,
    'player v0.9.0 wartet, bis das Programm beendet ist.'
  );
  assert.equal(programNotification([{ fullName: 'demo/editor', status: 'unchanged' }], 'en'), null);
  const reminder = reminderNotification(
    { pausedAt: '2026-11-07T00:00:00Z', completed: 3, total: 10 },
    'en',
    Date.parse('2026-11-08T01:00:00Z')
  );
  assert.equal(reminder.body, 'Paused for 25 hours, 3 of 10 done. Scheduled backups wait until you resume.');
});
