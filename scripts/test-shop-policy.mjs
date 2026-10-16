import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  bestEnabledShop,
  enabledShopEntries,
  hasStoredShopPrice,
  isShopEnabled,
} from './lib/shop-policy.mjs';

const card = {
  pricesByShop: {
    mercard: { latestPrice: 1200 },
    cardrush: { latestPrice: 999999 },
    torecard: { latestPrice: 1500 },
  },
};

assert.equal(isShopEnabled('mercard'), true);
assert.equal(isShopEnabled('cardrush'), false);
assert.deepEqual(enabledShopEntries(card).map(([shopId]) => shopId), ['mercard', 'torecard']);
assert.equal(bestEnabledShop(card)?.[0], 'torecard');
assert.equal(hasStoredShopPrice({ pricesByShop: { cardrush: { latestPrice: 100 } } }), true,
  '無効ショップの過去データは保持対象にする');

const scraper = await readFile(new URL('./scrape-prices.mjs', import.meta.url), 'utf8');
assert.doesNotMatch(scraper, /id:\s*'cardrush'/u, 'カードラッシュが取得対象に残っています');

console.log('Shop policy tests passed.');
