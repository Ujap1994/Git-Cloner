const SHORT_WAIT_MS = 60000, DEFAULT_WAIT_MS = 60000, MAX_WAIT_MS = 24 * 3600000;
function waitFrom(headers, now) {
  const after = headers?.get('retry-after');
  if (after) { const seconds = Number(after), at = Number.isFinite(seconds) ? now + seconds * 1000 : Date.parse(after); if (Number.isFinite(at)) return at - now; }
  const reset = Number(headers?.get('x-ratelimit-reset') ?? headers?.get('ratelimit-reset'));
  if (Number.isFinite(reset) && reset > 0) return reset > 1e9 ? reset * 1000 - now : reset * 1000;
  return DEFAULT_WAIT_MS;
}
function isRateLimited(response) {
  const headers = response.headers;
  return response.status === 429 || response.status === 403 && Boolean(headers?.get('retry-after') || headers?.get('x-ratelimit-remaining') === '0' || headers?.get('ratelimit-remaining') === '0');
}
// Short waits are retried in place; longer waits pause the queue until the provider releases requests again.
function rateLimitError(response, { label = 'GitHub', now = Date.now() } = {}) {
  if (!isRateLimited(response)) return null;
  const waitMs = Math.min(MAX_WAIT_MS, Math.max(1000, waitFrom(response.headers, now)));
  const error = new Error(`${label}-API-Limit erreicht (HTTP ${response.status}). Der Lauf wartet bis zur Freigabe.`);
  Object.assign(error, { rateLimited: true, helpCode: 'rate', status: response.status, retryable: waitMs <= SHORT_WAIT_MS, retryAfterMs: waitMs, rateLimitUntil: new Date(now + waitMs).toISOString() });
  return error;
}
function rateReady(queue, now = Date.now()) { const until = Date.parse(queue?.rateLimitUntil ?? ''); return !Number.isFinite(until) || until <= now; }
module.exports = { rateLimitError, isRateLimited, rateReady, SHORT_WAIT_MS };
