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

// バージョンは 3 箇所に散っているので、値ではなく一致していることを検証する
const swVersion = serviceWorkerSource.match(/APP_VERSION = '([^']+)'/)?.[1];
assert.ok(swVersion, 'service-worker.js に APP_VERSION がありません');
const indexHtml = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const htmlVersion = indexHtml.match(/name="application-version" content="([^"]+)"/)?.[1];
const manifest = JSON.parse(await readFile(new URL('../manifest.webmanifest', import.meta.url), 'utf8'));
assert.equal(htmlVersion, swVersion, 'index.html のバージョンが service-worker.js と一致しません');
assert.equal(manifest.version, swVersion, 'manifest.webmanifest のバージョンが service-worker.js と一致しません');

// オフラインで必要なファイルが app shell に含まれていること
for (const asset of ['./app.js', './vendor/chart.min.js', './index.html']) {
  assert.ok(serviceWorkerSource.includes(`'${asset}'`), `${asset} が APP_SHELL にありません`);
}
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
