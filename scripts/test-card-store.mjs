// 同一店舗の商品重複統合の回帰テスト。
// 実行: node scripts/test-card-store.mjs

import assert from 'node:assert/strict';
import { dedupeSameShopProducts, rekeyCards } from './lib/card-store.mjs';

function card(key, name, modelNo, sourceName, imageUrl, date, price) {
  return {
    key,
    name,
    modelNo,
    imageId: imageUrl,
    history: [],
    pricesByShop: {
      mercard: {
        shopName: 'メルカード',
        sourceName,
        imageUrl,
        latestPrice: price,
        history: [{ date, price }],
      },
    },
  };
}

const sameProduct = dedupeSameShopProducts(rekeyCards([
  card('old', 'モンキー・D・ルフィ【プロモ】《紫》', '四皇トレジャーゲットキャンペーンパック版P-099',
    'モンキー・D・ルフィ【プロモ】《紫》', 'https://shop.example/p-099.png', '2026/11/20', 600),
  card('new', 'モンキー・D・ルフィ【プロモ】《紫》', '四皇トレジャーゲットキャンペーンパック版P-099『OP17』',
    'モンキー・D・ルフィ【プロモ】《紫》', 'https://shop.example/p-099.png', '2026/11/27', 100),
]));
assert.equal(sameProduct.size, 1, '同じ店舗商品は説明欄の変更後も1件へ統合する');
const merged = [...sameProduct.values()][0];
assert.equal(merged.pricesByShop.mercard.latestPrice, 100, '最新掲載の価格を採用する');
assert.deepEqual(merged.pricesByShop.mercard.history, [
  { date: '2026/11/20', price: 600 },
  { date: '2026/11/27', price: 100 },
], '価格履歴は失わない');

const differentModel = dedupeSameShopProducts(rekeyCards([
  card('a', 'モンキー・D・ルフィ【SPパラレル】《赤》', 'ST15-005',
    'モンキー・D・ルフィ【SPパラレル】《赤》', 'https://shop.example/shared.png', '2026/11/27', 100000),
  card('b', 'モンキー・D・ルフィ【SPパラレル】《赤》', 'ST31-004',
    'モンキー・D・ルフィ【SPパラレル】《赤》', 'https://shop.example/shared.png', '2026/11/27', 40000),
]));
assert.equal(differentModel.size, 2, '画像と商品名が同じでもカード番号が違えば統合しない');

const openedState = dedupeSameShopProducts(rekeyCards([
  card('sealed', 'モンキー・D・ルフィ【プロモ】《赤》未開封', 'ST10-006',
    'モンキー・D・ルフィ【プロモ】《赤》未開封', 'https://shop.example/st10.png', '2026/11/27', 15000),
  card('opened', 'モンキー・D・ルフィ【プロモ】《赤》開封品', 'ST10-006',
    'モンキー・D・ルフィ【プロモ】《赤》開封品', 'https://shop.example/st10.png', '2026/11/27', 14000),
]));
assert.equal(openedState.size, 2, '同じ画像でも未開封と開封品は統合しない');

const differentPrint = dedupeSameShopProducts(rekeyCards([
  card('original', 'ロキ【描き下ろしパラレル】《黒》', '描き下ろしパラレル版OP17-119',
    'ロキ【描き下ろしパラレル】《黒》', 'https://shop.example/loki.png', '2026/11/21', 1400),
  card('reprint', 'ロキ【描き下ろしパラレル】《黒》', '描き下ろしパラレル版OP17-119『OP18』',
    'ロキ【描き下ろしパラレル】《黒》', 'https://shop.example/loki.png', '2026/11/27', 1000),
]));
assert.equal(differentPrint.size, 2, '同じ画像と商品名でも収録弾が違う再録は統合しない');

console.log('OK: 同一店舗の商品重複統合 4 件の回帰テストに合格');
