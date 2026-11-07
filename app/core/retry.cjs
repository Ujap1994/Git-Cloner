const { setTimeout: delay } = require('node:timers/promises');
const transientCodes = new Set([
  'ECONNRESET',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'ENETUNREACH',
  'ECONNREFUSED',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET'
]);
function transient(error) {
  return (
    !error?.retryExhausted &&
    (error?.retryable === true ||
      transientCodes.has(error?.code) ||
      transientCodes.has(error?.cause?.code) ||
      error?.name === 'TimeoutError')
  );
}
async function retry(
  fn,
  { retries = 2, baseDelay = 1000, sleep = delay, random = Math.random, onRetry = () => {}, signal } = {}
) {
  for (let attempt = 0; ; attempt++) {
    signal?.throwIfAborted();
    try {
      return await fn(attempt);
    } catch (error) {
      if (attempt >= retries || !transient(error)) {
        if (retries > 0 && transient(error)) error.retryExhausted = true;
        throw error;
      }
      const wait = Math.min(60000, Math.max(error.retryAfterMs || 0, baseDelay * 2 ** attempt * (1 + random() * 0.2)));
      onRetry({ attempt: attempt + 1, delay: wait });
      await sleep(wait, undefined, { signal });
    }
  }
}
module.exports = { retry, transient };
