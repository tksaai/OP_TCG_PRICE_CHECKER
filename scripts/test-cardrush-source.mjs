import assert from 'node:assert/strict';
import { scrapeCardrushBuyingPrices } from './lib/cardrush-source.mjs';

const requestedUrls = [];
const pages = [
  {
    result: true,
    last_page: 2,
    records: [
      { id: 1, name: 'ルフィ', extra_difference: 'パラレル', model_number: 'OP01-001', amount: 1000, rarity: 'L', original_image_source: 'image-1' },
      { id: 2, name: 'ゾロ', model_number: 'OP01-002', amount: 500, rarity: 'SR', original_image_source: 'image-2' },
    ],
  },
  {
    result: true,
    last_page: 2,
    records: [
      { id: 2, name: 'ゾロ', model_number: 'OP01-002', amount: 600, rarity: 'SR', original_image_source: 'image-2-new' },
      { id: 3, name: 'ナミ', model_number: 'OP01-003', amount: 0, rarity: 'R', original_image_source: 'image-3' },
    ],
  },
];

const cards = await scrapeCardrushBuyingPrices({
  url: 'https://cardrush.example/api/proxy/onepiece/buying_prices',
  headers: { referer: 'https://cardrush.example/onepiece/buying_prices' },
}, {
  pageSize: 500,
  waitImpl: async () => {},
  fetchTextImpl: async (url, options) => {
    requestedUrls.push({ url, options });
    const page = Number(new URL(url).searchParams.get('page'));
    return JSON.stringify(pages[page - 1]);
  },
});

assert.equal(requestedUrls.length, 2);
assert.equal(new URL(requestedUrls[0].url).searchParams.get('limit'), '500');
assert.equal(new URL(requestedUrls[1].url).searchParams.get('page'), '2');
assert.equal(requestedUrls[0].options.headers.referer, 'https://cardrush.example/onepiece/buying_prices');
assert.deepEqual(cards, [
  { name: 'ルフィ(パラレル)', modelNo: 'OP01-001', imageUrl: 'image-1', price: 1000, rarity: 'L' },
  { name: 'ゾロ', modelNo: 'OP01-002', imageUrl: 'image-2-new', price: 600, rarity: 'SR' },
]);

await assert.rejects(
  scrapeCardrushBuyingPrices({ url: 'https://cardrush.example/api' }, {
    waitImpl: async () => {},
    fetchTextImpl: async () => JSON.stringify({ result: false, records: [], last_page: 1 }),
  }),
  /invalid response/u,
);

await assert.rejects(
  scrapeCardrushBuyingPrices({ url: 'https://cardrush.example/api' }, {
    waitImpl: async () => {},
    fetchTextImpl: async () => JSON.stringify({ result: true, records: [], last_page: 101 }),
  }),
  /invalid last_page/u,
);

console.log('Cardrush source tests passed.');
