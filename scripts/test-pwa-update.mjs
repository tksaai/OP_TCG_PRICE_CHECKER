import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const require = createRequire(import.meta.url);
const pwaUpdate = require('../pwa-update.js');

function response(headers, ok = true) {
  const normalized = new Map(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  return {
    ok,
    headers: { get: (name) => normalized.get(String(name).toLowerCase()) || null },
  };
}

assert.equal(
  pwaUpdate.responseVersion(response({ etag: '"abc"', 'last-modified': 'today', 'content-length': '10' })),
  '"abc"|today|10'
);
assert.equal(pwaUpdate.responseVersion(response({}, false)), '');
assert.equal(pwaUpdate.signaturesDiffer('a', 'b'), true);
assert.equal(pwaUpdate.signaturesDiffer('a', 'a'), false);
assert.equal(pwaUpdate.signaturesDiffer(null, 'a'), false);
assert.equal(pwaUpdate.AUTO_UPDATE_DELAY_MS, 8000);

const requested = [];
const signature = await pwaUpdate.fetchVersionSignature(async (url, options) => {
  requested.push({ url, options });
  return response({ etag: `"${new URL(url).pathname}"` });
}, 'https://example.com/app/index.html');
assert.equal(requested.length, pwaUpdate.TRACKED_ASSETS.length);
assert.ok(requested.every((item) => item.options.method === 'HEAD' && item.options.cache === 'no-store'));
assert.ok(signature.includes('data/cards.json'));
assert.ok(signature.includes('data/db-catalog.json'));
assert.ok(signature.includes('data/db-variant-map.json'));

const serviceWorkerSource = await readFile(new URL('../service-worker.js', import.meta.url), 'utf8');
assert.match(serviceWorkerSource, /APP_VERSION = '2\.1\.0'/);
const registeredEvents = [];
vm.runInNewContext(serviceWorkerSource, {
  URL,
  fetch: async () => response({}),
  caches: {
    open: async () => ({ addAll: async () => {}, put: async () => {}, match: async () => null }),
    keys: async () => [],
    delete: async () => true,
    match: async () => null,
  },
  self: {
    location: { origin: 'https://example.com' },
    registration: { scope: 'https://example.com/app/' },
    clients: { claim: async () => {} },
    skipWaiting: async () => {},
    addEventListener: (name) => registeredEvents.push(name),
  },
});
assert.deepEqual(registeredEvents.sort(), ['activate', 'fetch', 'install', 'message']);

console.log('PWA update tests passed.');
