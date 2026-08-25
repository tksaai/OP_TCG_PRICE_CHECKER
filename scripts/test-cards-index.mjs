import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { buildCardsIndex, latestDateOf, summarizeHistory } from './lib/cards-index.mjs';

const LATEST = '2026/08/25';

// --- summarizeHistory -----------------------------------------------------
{
  const history = [
    { date: '2026/08/01', price: 1000 },
    { date: '2026/08/24', price: 1200 },
    { date: '2026/08/25', price: 1500 },
  ];
  const stats = summarizeHistory(history, 1500, LATEST);
  assert.equal(stats.trendDiff, 300, '最新日に更新があれば前日比が出る');
  assert.equal(Math.round(stats.trendPercent), 25);
  assert.equal(stats.minPrice, 1000);
  assert.equal(stats.maxPrice, 1500);
  assert.equal(stats.lastDate, '2026/08/25');
  assert.equal(stats.weeklyDiff, 500, '7日より前の価格と比べる');
}

// 更新が止まったショップに「前日比」を出さない (カードラッシュが止まった実例)
{
  const history = [
    { date: '2026/07/13', price: 9000 },
    { date: '2026/07/15', price: 10000 },
  ];
  const stats = summarizeHistory(history, 10000, LATEST);
  assert.equal(stats.trendDiff, 0, '最新日でなければ前日比は 0');
  assert.equal(stats.weeklyDiff, 0, '直近1週間に記録が無ければ週間比も 0');
  assert.equal(stats.maxPrice, 10000, '最安・最高は履歴全体から出す');
  assert.equal(stats.lastDate, '2026/07/15');
}

// 履歴が空でも壊れない
{
  const stats = summarizeHistory([], 0, LATEST);
  assert.deepEqual(stats, {
    trendDiff: 0, trendPercent: 0, weeklyDiff: 0, weeklyPercent: 0,
    minPrice: 0, maxPrice: 0, lastDate: '',
  });
}

// --- latestDateOf / buildCardsIndex --------------------------------------
const cards = [
  {
    key: 'OP01-001_NORMAL',
    name: 'テストカード',
    modelNo: 'OP01-001',
    imageId: 'https://example.com/a.webp',
    bestShopId: 'shopA',
    latestPrice: 1500,
    history: [{ date: '2026/08/25', price: 1500 }],
    pricesByShop: {
      shopA: {
        shopName: 'ショップA', sourceName: 'テストカード【A表記】',
        latestPrice: 1500, imageUrl: 'https://example.com/a.webp',
        sourceUrl: 'https://example.com/a',
        history: [{ date: '2026/08/24', price: 1200 }, { date: '2026/08/25', price: 1500 }],
      },
      shopB: {
        shopName: 'ショップB', sourceName: 'テストカード B',
        latestPrice: 900, imageUrl: '',
        history: [{ date: '2026/07/15', price: 900 }],
      },
    },
  },
];

assert.equal(latestDateOf(cards), '2026/08/25');

const index = buildCardsIndex(cards);
assert.equal(index.length, 1);
const [entry] = index;
assert.equal(entry.key, 'OP01-001_NORMAL');
assert.equal(entry.latestPrice, 1500);
assert.equal(entry.pricesByShop.shopA.stats.trendDiff, 300);
assert.equal(entry.pricesByShop.shopB.stats.trendDiff, 0, '止まっているショップに前日比を出さない');
assert.equal(entry.pricesByShop.shopA.sourceName, 'テストカード【A表記】', 'マージなし表示に使う名前を残す');

// 履歴は落とす (一覧を軽くするのが目的)
assert.equal(entry.history, undefined);
assert.equal(entry.pricesByShop.shopA.history, undefined);

// --- 実データがあれば、そのファイルとも突き合わせる ------------------------
// (サイズの比較はここで見る。履歴が数件しかないサンプルでは、
//  事前計算した stats のぶんインデックスの方が大きくなるため)
try {
  const realCardsRaw = await readFile(new URL('../data/cards.json', import.meta.url), 'utf8');
  const realIndexRaw = await readFile(new URL('../data/cards-index.json', import.meta.url), 'utf8');
  const realCards = JSON.parse(realCardsRaw);
  const realIndex = JSON.parse(realIndexRaw);
  assert.equal(realIndex.length, realCards.length, 'cards-index.json の件数が cards.json と一致しません');
  assert.ok(realIndex.every(card => card.key && card.pricesByShop), 'cards-index.json の形式が壊れています');
  assert.ok(
    realIndexRaw.length < realCardsRaw.length * 0.5,
    `インデックスが十分に小さくなっていません (${realIndexRaw.length} / ${realCardsRaw.length})`
  );
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  console.log('(data/cards-index.json が無いので実データ検証はスキップ)');
}

console.log('Cards index tests passed.');
