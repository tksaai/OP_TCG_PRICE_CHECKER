import assert from 'node:assert/strict';
import { BROWSER_HEADERS, fetchText } from './lib/http-fetch.mjs';

let receivedOptions;
const direct = await fetchText('https://shop.example/cards', {
  fetchImpl: async (_url, options) => {
    receivedOptions = options;
    return { ok: true, status: 200, statusText: 'OK', text: async () => 'direct body' };
  },
  curlImpl: async () => assert.fail('成功時に curl を呼んではいけません'),
});
assert.equal(direct, 'direct body');
assert.equal(receivedOptions.headers['user-agent'], BROWSER_HEADERS['user-agent']);
assert.equal(receivedOptions.redirect, 'follow');

let fallbackHeaders;
const fallback = await fetchText('https://shop.example/blocked', {
  headers: { referer: 'https://shop.example/' },
  fetchImpl: async () => ({ ok: false, status: 403, statusText: 'Forbidden' }),
  curlImpl: async (_url, headers) => {
    fallbackHeaders = headers;
    return 'curl body';
  },
});
assert.equal(fallback, 'curl body');
assert.equal(fallbackHeaders.referer, 'https://shop.example/');
assert.equal(fallbackHeaders['user-agent'], BROWSER_HEADERS['user-agent']);

let fallbackCalls = 0;
await assert.rejects(
  fetchText('https://shop.example/not-found', {
    fetchImpl: async () => ({ ok: false, status: 404, statusText: 'Not Found' }),
    curlImpl: async () => { fallbackCalls += 1; },
  }),
  /404 Not Found/u,
);
assert.equal(fallbackCalls, 0, '恒久的な404ではフォールバックしません');

await assert.rejects(
  fetchText('https://shop.example/blocked', {
    fetchImpl: async () => ({ ok: false, status: 403, statusText: 'Forbidden' }),
    curlImpl: async () => { throw new Error('curl refused'); },
  }),
  /403 Forbidden; curl fallback failed: curl refused/u,
);

console.log('HTTP fetch fallback tests passed.');
