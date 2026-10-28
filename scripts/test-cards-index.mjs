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
      cardrush: {
        shopName: 'カードラッシュ', sourceName: '非表示カード',
        latestPrice: 999999, imageUrl: 'https://example.com/cardrush.webp',
        history: [{ date: '2026/08/26', price: 999999 }],
      },
    },
  },
  {
    key: 'OP01-002_NORMAL',
    name: '無効ショップのみ',
    modelNo: 'OP01-002',
    bestShopId: 'cardrush',
    latestPrice: 5000,
    pricesByShop: {
      cardrush: {
        shopName: 'カードラッシュ', latestPrice: 5000,
        imageUrl: 'https://example.com/cardrush-only.webp',
        history: [{ date: '2026/08/27', price: 5000 }],
      },
    },
  },
];

assert.equal(latestDateOf(cards), '2026/08/25');

const index = buildCardsIndex(cards);
assert.equal(index.length, 1, '無効ショップしかないカードは一覧へ出さない');
const [entry] = index;
assert.equal(entry.key, 'OP01-001_NORMAL');
assert.equal(entry.latestPrice, 1500);
assert.equal(entry.bestShopId, 'shopA', '無効ショップを最高買取にしない');
assert.equal(entry.pricesByShop.cardrush, undefined, '無効ショップを一覧データへ含めない');
assert.equal(entry.pricesByShop.shopA.stats.trendDiff, 300);
assert.equal(entry.pricesByShop.shopB.stats.trendDiff, 0, '止まっているショップに前日比を出さない');
assert.equal(entry.pricesByShop.shopA.sourceName, 'テストカード【A表記】', 'マージなし表示に使う名前を残す');

const pausedIndex = buildCardsIndex(cards, new Set(['shopA']));
assert.equal(pausedIndex[0].bestShopId, 'shopB', '休止ショップを最高買取から除外する');
assert.equal(pausedIndex[0].latestPrice, 900);
assert.equal(pausedIndex[0].pricesByShop.shopA, undefined);

// 履歴は落とす (一覧を軽くするのが目的)
assert.equal(entry.history, undefined);
assert.equal(entry.pricesByShop.shopA.history, undefined);

// --- 実データがあれば、そのファイルとも突き合わせる ------------------------
try {
  const realCardsJson = await readFile(new URL('../data/cards.json', import.meta.url), 'utf8');
  const realIndexJson = await readFile(new URL('../data/cards-index.json', import.meta.url), 'utf8');
  const realCards = JSON.parse(realCardsJson);
  const realIndex = JSON.parse(realIndexJson);
  assert.ok(realIndex.length <= realCards.length, 'cards-index.json が cards.json より多くなっています');
  assert.ok(realIndex.every(card => card.key && card.pricesByShop), 'cards-index.json の形式が壊れています');
  assert.ok(realIndex.every(card => !card.pricesByShop.cardrush), 'cards-index.json に無効ショップが残っています');
  assert.ok(realIndexJson.length < realCardsJson.length, '実データのインデックスは元データより小さいこと');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  console.log('(data/cards-index.json が無いので実データ検証はスキップ)');
}

console.log('Cards index tests passed.');
