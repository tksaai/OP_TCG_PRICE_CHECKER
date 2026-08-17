import assert from 'node:assert/strict';
import {
  flattenCards,
  generateAliasCandidates,
  hardSignature,
  hardTagsFromAliasKeys,
  imageAnalysisFor,
} from './generate-alias-candidates.mjs';

function card(key, name, shopId, latestPrice, imageUrl) {
  return {
    key,
    name,
    modelNo: 'OP01-016',
    imageId: imageUrl,
    pricesByShop: {
      [shopId]: {
        shopName: shopId,
        sourceName: name,
        latestPrice,
        imageUrl,
      },
    },
  };
}

assert.notEqual(hardSignature(['opened', 'serial']), hardSignature(['unopened', 'serial']));
assert.notEqual(hardSignature(['promo']), hardSignature([]));
assert.notEqual(hardSignature(['prize-letter']), hardSignature(['card-only']));
assert.notEqual(hardSignature(['flagship']), hardSignature(['judge']));
assert.deepEqual(
  hardTagsFromAliasKeys({ aliasKeys: ['op01-016@cs+unopened'] }, 'OP01-016'),
  ['cs', 'unopened']
);

const conditionRecords = flattenCards([
  card('opened', 'ナミ(開封品/シリアル入り)', 'mercard', 1000, 'opened'),
  card('unopened', 'ナミ(未開封/シリアル入り)', 'torecard', 1000, 'unopened'),
]);
assert.notEqual(conditionRecords[0].signature, conditionRecords[1].signature);
assert.equal(generateAliasCandidates([
  card('opened', 'ナミ(開封品/シリアル入り)', 'mercard', 1000, 'opened'),
  card('unopened', 'ナミ(未開封/シリアル入り)', 'torecard', 1000, 'unopened'),
]).length, 0, '開封済みと未開封だけを同じ候補にしてはいけない');

const genericChampionship = card(
  'championship',
  'ナミ【プロモ】《赤》未開封',
  'mercard',
  100000,
  'championship'
);
genericChampionship.aliasKeys = ['op01-016@cs+unopened'];
const [championshipRecord] = flattenCards([genericChampionship]);
assert.equal(
  championshipRecord.signature,
  'cs+unopened',
  '短い店舗名でも既存キーからチャンピオンシップ属性を復元する'
);

const reviewCards = [
  card('a', 'ナミ(パラレル/illust:A)', 'mercard', 10000, 'a'),
  card('b', 'ナミ(パラレル/illust:B)', 'cardrush', 2000, 'b'),
  card('c', 'ナミ(パラレル/illust:C)', 'cardrush', 1000, 'c'),
];
const hashes = {
  a: { dhash: '0000000000000000' },
  b: { dhash: '0000000000000000' },
  c: { dhash: 'ffffffffffffffff' },
};
const [candidate] = generateAliasCandidates(reviewCards, hashes);
assert.ok(candidate, '表記揺れ候補を生成できること');
assert.equal(candidate.imageStats.max, 100);
assert.equal(candidate.imageStats.min, 0);
assert.equal(candidate.imageStats.pairCount, 2, '同一店舗どうしの画像は比較しない');
assert.equal(candidate.riskLevel, 'high');
assert.ok(candidate.warnings.some((warning) => warning.includes('同一店舗')));
assert.ok(candidate.warnings.some((warning) => warning.includes('画像類似度')));
assert.ok(candidate.records.every((record) => Array.isArray(record.tags)));

const [candidateWithoutImages] = generateAliasCandidates(reviewCards, {});
assert.equal(
  candidate.candidateScore,
  candidateWithoutImages.candidateScore,
  '公式画像と実物写真の差で候補度を上下させない'
);

const directStats = imageAnalysisFor(
  [
    { shopId: 'a', imageUrl: 'a' },
    { shopId: 'b', imageUrl: 'b' },
    { shopId: 'c', imageUrl: 'c' },
  ],
  hashes
);
assert.deepEqual(
  { max: directStats.max, median: directStats.median, min: directStats.min, pairCount: directStats.pairCount },
  { max: 100, median: 0, min: 0, pairCount: 3 }
);

console.log('OK: 名寄せ候補の安全性テストに合格');
