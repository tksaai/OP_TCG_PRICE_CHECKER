import assert from 'node:assert/strict';
import {
  IMPORT_MODE_ADD,
  IMPORT_MODE_REPLACE_MATCHED,
  applyCollectionMatches,
  createUnmatchedExport,
  matchCollectionPayload,
  unmatchedExportToCsv,
  validateCollectionPayload,
} from './lib/op-tcg-db-collection.mjs';

const priceCards = [
  { key: 'op01-001', name: 'ロロノア・ゾロ', modelNo: 'OP01-001', imageId: 'normal.png' },
  { key: 'op01-001@parallel', name: 'ロロノア・ゾロ【パラレル】', modelNo: 'OP01-001', imageId: 'p1.png' },
  { key: 'op01-001@comic', name: 'ロロノア・ゾロ【コミック版パラレル】', modelNo: 'OP01-001', imageId: 'p2.png' },
  { key: 'op02-001', name: '仮DBテスト', modelNo: 'OP02-001', imageId: 'provisional.png' },
  { key: 'op03-001@parallel', name: '候補A【パラレル】', modelNo: 'OP03-001', imageId: 'a.png' },
  { key: 'op03-001@comic', name: '候補B【コミック版パラレル】', modelNo: 'OP03-001', imageId: 'b.png' },
  { canonicalId: 'OP04-001_ONLY', key: 'op04-001', name: '唯一候補', modelNo: 'OP04-001', imageId: 'only.png' },
];

const item = (cardNumber, variantId, variantType, count, cardName = 'テスト') => ({
  id: `${cardNumber}::${variantId}`,
  cardNumber,
  cardName,
  variantId,
  variantType,
  variantIndex: variantType === 'normal' ? 0 : 1,
  count,
  updatedAt: '2026-08-22T00:00:00.000Z',
});

const payload = {
  format: 'op-tcg-db-collection',
  version: 1,
  appVersion: '1.9.0',
  exportedAt: '2026-08-22T00:00:00.000Z',
  items: [
    item('OP01-001', 'OP01-001', 'normal', 2, 'ロロノア・ゾロ'),
    item('OP01-001', 'OP01-001_p1', 'alternate-art', 3, 'ロロノア・ゾロ'),
    item('OP01-001', 'OP01-001_p2', 'alternate-art', 4, 'ロロノア・ゾロ'),
    item('OP02-001', 'OP02-001_p1', 'alternate-art', 1, '仮DBテスト'),
    item('OP03-001', 'OP03-001_p1', 'alternate-art', 5, '候補複数'),
    item('OP04-001', 'OP04-001', 'normal', 6, '唯一候補'),
  ],
  openingSessions: [{ id: 'ignored', items: { unexpected: 999 } }],
};

const dbCatalog = {
  variants: [
    { variantKey: 'OP01-001::OP01-001', cardNumber: 'OP01-001', variantId: 'OP01-001', variantType: 'normal', identityTags: [], provisional: false },
    { variantKey: 'OP01-001::OP01-001_p1', cardNumber: 'OP01-001', variantId: 'OP01-001_p1', variantType: 'alternate-art', identityTags: ['parallel'], provisional: false },
    { variantKey: 'OP01-001::OP01-001_p2', cardNumber: 'OP01-001', variantId: 'OP01-001_p2', variantType: 'alternate-art', identityTags: [], imageHash: 'hash-p2', provisional: false },
    { variantKey: 'OP02-001::OP02-001_p1', cardNumber: 'OP02-001', variantId: 'OP02-001_p1', variantType: 'alternate-art', identityTags: [], provisional: true },
    { variantKey: 'OP03-001::OP03-001_p1', cardNumber: 'OP03-001', variantId: 'OP03-001_p1', variantType: 'alternate-art', identityTags: [], provisional: false },
    { variantKey: 'OP04-001::OP04-001', cardNumber: 'OP04-001', variantId: 'OP04-001', variantType: 'normal', identityTags: [], provisional: false },
  ],
};

const result = matchCollectionPayload(payload, {
  priceCards,
  dbCatalog,
  imageHashes: { 'p2.png': { dhash: 'hash-p2' } },
  manualAliases: {
    mappings: {
      'OP01-001::OP01-001_p1': { priceKey: 'op01-001@parallel', note: '手動確認' },
    },
  },
  variantMap: {
    mappings: {
      // 手動表が生成表より優先されることを確認する。
      'OP01-001::OP01-001_p1': { priceKey: 'op01-001@comic', confirmedBy: 'image-path' },
    },
  },
});

assert.deepEqual(result.summary, {
  totalCards: 21,
  totalKinds: 6,
  matchedKinds: 4,
  matchedCards: 15,
  ambiguousKinds: 1,
  unmatchedKinds: 1,
});
assert.equal(result.results[0].priceKey, 'op01-001');
assert.equal(result.results[1].priceKey, 'op01-001@parallel');
assert.equal(result.results[1].method, 'manual-alias');
assert.equal(result.results[2].method, 'image-hash');
assert.equal(result.results[3].reason, 'provisional-unconfirmed');
assert.equal(result.results[4].status, 'ambiguous');
assert.equal(result.results[5].priceKey, 'OP04-001_ONLY');
assert.equal(result.payload.openingSessions[0].items.unexpected, 999);

const combinedPayload = {
  ...payload,
  items: [
    item('OP01-001', 'OP01-001_p1', 'alternate-art', 2),
    item('OP01-001', 'OP01-001_p2', 'alternate-art', 5),
  ],
};
const combined = matchCollectionPayload(combinedPayload, {
  priceCards,
  dbCatalog,
  manualAliases: {
    mappings: {
      'OP01-001::OP01-001_p1': 'op01-001@parallel',
      'OP01-001::OP01-001_p2': 'op01-001@parallel',
    },
  },
});
assert.equal(combined.matches.length, 1);
assert.equal(combined.matches[0].count, 7);

const unsafeUniqueNormal = matchCollectionPayload({
  ...payload,
  items: [item('OP05-001', 'OP05-001', 'normal', 1)],
}, {
  priceCards: [{ key: 'op05-001@parallel', name: '通常版ではない【パラレル】', modelNo: 'OP05-001' }],
  dbCatalog: { variants: [{
    variantKey: 'OP05-001::OP05-001', cardNumber: 'OP05-001', variantId: 'OP05-001',
    variantType: 'normal', identityTags: [], provisional: false,
  }] },
});
assert.equal(unsafeUniqueNormal.matches.length, 0);
assert.equal(unsafeUniqueNormal.unmatched[0].reason, 'variant-unconfirmed');

assert.deepEqual(
  applyCollectionMatches({ unrelated: 9, 'op01-001': 1 }, [{ priceKey: 'op01-001', count: 2 }], IMPORT_MODE_REPLACE_MATCHED),
  { unrelated: 9, 'op01-001': 2 }
);
assert.deepEqual(
  applyCollectionMatches({ unrelated: 9, 'op01-001': 1 }, [{ priceKey: 'op01-001', count: 2 }], IMPORT_MODE_ADD),
  { unrelated: 9, 'op01-001': 3 }
);

const unresolvedExport = createUnmatchedExport(result);
assert.equal(unresolvedExport.items.length, 2);
const ambiguousExport = unresolvedExport.items.find(entry => entry.matchStatus === 'ambiguous');
assert.equal(ambiguousExport.manualMappingKey, 'OP03-001::OP03-001_p1');
assert.equal(ambiguousExport.manualMappingOptions.length, 2);
assert.ok(unmatchedExportToCsv(result).includes('provisional-unconfirmed'));
assert.ok(unmatchedExportToCsv(result).includes('card-number-multiple'));

assert.throws(
  () => validateCollectionPayload({ ...payload, format: 'unknown' }),
  /対応していない形式/u
);
assert.throws(
  () => validateCollectionPayload({ ...payload, version: 2 }),
  /未対応/u
);
assert.throws(
  () => validateCollectionPayload({ ...payload, items: [{ ...payload.items[0], count: -1 }] }),
  /0以上の整数/u
);

console.log('Collection import tests passed.');
