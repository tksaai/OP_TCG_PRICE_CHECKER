import '../search-utils.js';
import assert from 'node:assert/strict';

const {
  createSearchIndex,
  matchesSearch,
  normalizeSearchText,
  parseSearchQuery,
} = globalThis.OPSearchUtils;

const index = createSearchIndex({
  name: 'シャンクス【コミパラ】',
  modelNo: 'OP01-120',
  details: {
    cardName: 'シャンクス',
    furigana: 'シャンクス',
    features: ['赤髪海賊団', '四皇'],
    effectText: '【速攻】このキャラは登場したターンにアタックできる。',
  },
  pricesByShop: {
    mercard: { shopName: 'メルカード', sourceName: 'シャンクス SEC' },
  },
});

assert.equal(normalizeSearchText('しゃんくす'), 'シャンクス');
assert.equal(matchesSearch(index, parseSearchQuery('しゃんくす OP０１－１２０'), 'AND', true), true);
assert.equal(matchesSearch(index, parseSearchQuery('ゾロ 四皇'), 'OR', true), true);
assert.equal(matchesSearch(index, parseSearchQuery('ゾロ 四皇'), 'AND', true), false);
assert.equal(matchesSearch(index, parseSearchQuery('シャンクシ'), 'AND', true), true);
assert.equal(matchesSearch(index, parseSearchQuery('シャンクシ'), 'AND', false), false);
assert.equal(matchesSearch(index, parseSearchQuery('シャンクス -四皇'), 'AND', true), false);
assert.equal(matchesSearch(index, parseSearchQuery('"赤髪海賊団"'), 'AND', true), true);

console.log('Search utility tests passed.');
