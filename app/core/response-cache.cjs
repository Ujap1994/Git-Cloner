// ETag cache shared by the GitHub and the GitLab/Gitea/Forgejo clients.
// It keeps the compact response text instead of parsed objects: a parsed release list takes several times its text
// size, and the old object cache also needed a full clone per request. Text is parsed once per response, so callers
// get their own copy without cloning. Entries used again move to the end and are evicted last.
async function readBody(response) {
  if (typeof response.text !== 'function') return { data: await response.json(), text: null };
  const text = await response.text();
  return { data: JSON.parse(text), text };
}
function cachedData(client, endpoint, entry) {
  client.cache.delete(endpoint); client.cache.set(endpoint, entry);
  return JSON.parse(entry.text);
}
function remember(client, endpoint, etag, { data, text }) {
  const old = client.cache.get(endpoint);
  if (old) { client.cacheStats.bytes -= old.size; client.cache.delete(endpoint); }
  if (!etag) return;
  const body = text ?? JSON.stringify(data), size = Buffer.byteLength(body);
  if (size > client.cacheLimit) return;
  while (client.cache.size && (client.cache.size >= 2000 || client.cacheStats.bytes + size > client.cacheLimit)) {
    const key = client.cache.keys().next().value; client.cacheStats.bytes -= client.cache.get(key).size; client.cache.delete(key);
  }
  client.cache.set(endpoint, { etag, text: body, size }); client.cacheStats.bytes += size;
}
// Ten repositories with long release histories already need about 17 MB of release lists per run; a smaller limit
// evicts every list shortly before it is requested again, so no request could ever be answered with 304. 32 MB of
// text occupy about as much memory as the former 16 MB limit did as parsed objects.
const CACHE_LIMIT = 32 * 1048576;
module.exports = { readBody, cachedData, remember, CACHE_LIMIT };
