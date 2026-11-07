const SHORT_WAIT_MS = 60000,
  DEFAULT_WAIT_MS = 60000,
  MAX_WAIT_MS = 24 * 3600000,
  BODY_LIMIT = 65536;
const RATE_BODY = /rate limit|too many requests/i;
function waitFrom(headers, now) {
  const after = headers?.get('retry-after');
  if (after) {
    const seconds = Number(after),
      at = Number.isFinite(seconds) ? now + seconds * 1000 : Date.parse(after);
    if (Number.isFinite(at)) return at - now;
  }
  const reset = Number(headers?.get('x-ratelimit-reset') ?? headers?.get('ratelimit-reset'));
  if (Number.isFinite(reset) && reset > 0) return reset > 1e9 ? reset * 1000 - now : reset * 1000;
  return DEFAULT_WAIT_MS;
}
function isRateLimited(response, body = '') {
  const headers = response.headers;
  return (
    response.status === 429 ||
    (response.status === 403 &&
      Boolean(
        headers?.get('retry-after') ||
        headers?.get('x-ratelimit-remaining') === '0' ||
        headers?.get('ratelimit-remaining') === '0' ||
        RATE_BODY.test(body)
      ))
  );
}
// Short waits are retried in place; longer waits pause the queue until the provider releases requests again.
function rateLimitError(response, { label = 'GitHub', now = Date.now(), body = '' } = {}) {
  if (!isRateLimited(response, body)) return null;
  const waitMs = Math.min(MAX_WAIT_MS, Math.max(1000, waitFrom(response.headers, now)));
  const error = new Error(`${label}-API-Limit erreicht (HTTP ${response.status}). Der Lauf wartet bis zur Freigabe.`);
  Object.assign(error, {
    rateLimited: true,
    helpCode: 'rate',
    status: response.status,
    retryable: waitMs <= SHORT_WAIT_MS,
    retryAfterMs: waitMs,
    rateLimitUntil: new Date(now + waitMs).toISOString()
  });
  return error;
}
async function boundedText(response) {
  const reader = response.body?.getReader?.();
  if (!reader)
    return typeof response.text === 'function'
      ? String(await response.text().catch(() => '')).slice(0, BODY_LIMIT)
      : '';
  const chunks = [];
  let size = 0;
  try {
    while (size < BODY_LIMIT) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.length;
    }
  } catch (_error) {
    /* An unreadable error body only disables the text-based detection. */
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks.map(chunk => Buffer.from(chunk))).toString('utf8', 0, Math.min(size, BODY_LIMIT));
}
// GitHub secondary limits can arrive as HTTP 403 without rate headers; only then is the small error body inspected.
async function responseRateLimit(response, options = {}) {
  if (![403, 429].includes(response.status)) return null;
  const direct = rateLimitError(response, options);
  if (direct || response.status !== 403) return direct;
  return rateLimitError(response, { ...options, body: await boundedText(response) });
}
function rateReady(queue, now = Date.now()) {
  const until = Date.parse(queue?.rateLimitUntil ?? '');
  return !Number.isFinite(until) || until <= now;
}
module.exports = { rateLimitError, responseRateLimit, isRateLimited, rateReady, SHORT_WAIT_MS };
