import assert from 'node:assert/strict';
import { parseTorecardBuyingPage, scrapeTorecardBuyingPrices } from './lib/torecard-source.mjs';

const paused = parseTorecardBuyingPage(`
  <main><p>店頭買取・宅配買取を休止しております。</p><p>再開時にお知らせします。</p></main>
`, 'https://www.torecard.com/purchase/onepiece/list/');
assert.equal(paused.status, 'paused');
assert.equal(paused.cards.length, 0);
assert.match(paused.message, /休止/u);

const active = parseTorecardBuyingPage(`
  <ul>
    <li data-id="1" class="featured list-group-item active">
      <img src="/images/op01.jpg" alt="ロロノア・ゾロ 【SR】【OP01-025】" class="card-list-img lazy">
      <div class="card-list-price text-danger"><span>12,000</span>円</div>
      <div class="card-list-name">ロロノア・ゾロ 【SR】【OP01-025】</div>
    </li>
  </ul>
`, 'https://www.torecard.com/purchase/onepiece/list/');
assert.equal(active.status, 'active');
assert.deepEqual(active.cards, [{
  name: 'ロロノア・ゾロ 【SR】【OP01-025】',
  modelNo: 'OP01-025',
  imageUrl: 'https://www.torecard.com/images/op01.jpg',
  price: 12000,
}]);

const fetched = await scrapeTorecardBuyingPrices(
  { url: 'https://www.torecard.com/purchase/onepiece/list/' },
  { fetchText: async () => '<p>買取を休止しております</p>' },
);
assert.equal(fetched.status, 'paused');

console.log('Torecard source tests passed.');
