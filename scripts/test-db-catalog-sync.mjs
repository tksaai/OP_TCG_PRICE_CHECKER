import assert from 'node:assert/strict';
import { generateVariantMappings } from './lib/op-tcg-db-collection.mjs';
import { buildDbCatalog } from './sync-db-catalog.mjs';

const cards = Array.from({ length: 100 }, (_, index) => ({
  cardNumber: `OP99-${String(index + 1).padStart(3, '0')}`,
  cardName: `テスト${index + 1}`,
}));
cards.push(
  { cardNumber: 'OP01-001', cardName: 'ロロノア・ゾロ' },
  { cardNumber: 'OP02-001', cardName: 'テストカード' },
  { cardNumber: 'OP03-001', cardName: '仮カード' },
);

const manifest = {
  generatedAt: '2026-08-22T00:00:00.000Z',
  cards: {
    'OP01-001': [
      { sourceUrl: 'https://db.example/OP01-001.png', path: 'Cards/OP01-001.png', variantIndex: 0, label: '通常' },
      { sourceUrl: 'https://db.example/OP01-001_p1.png', path: 'Cards/OP01-001_p1.png', variantIndex: 1, label: '別イラスト 2' },
    ],
    'OP02-001': [
      { sourceUrl: 'https://db.example/OP02-001.png', path: 'Cards/OP02-001.png', variantIndex: 0, label: '通常' },
    ],
  },
};

const provisional = [
  {
    uniqueId: 'OP02-001_provisional.jpg',
    cardNumber: 'OP02-001',
    cardName: 'テストカード',
    imagePath: 'Cards/Provisional/OP02-001_provisional.jpg',
    provisionalImageUrl: 'https://db.example/provisional-2.jpg',
  },
  {
    uniqueId: 'OP03-001_provisional.jpg',
    cardNumber: 'OP03-001',
    cardName: '仮カード',
    imagePath: 'Cards/Provisional/OP03-001_provisional.jpg',
    provisionalImageUrl: 'https://db.example/provisional-3.jpg',
  },
];

const catalog = buildDbCatalog(cards, manifest, provisional);
assert.equal(catalog.variants.length, 5);
assert.equal(catalog.variants.find(item => item.variantKey === 'OP01-001::OP01-001_p1').variantType, 'alternate-art');
assert.equal(catalog.variants.find(item => item.variantKey === 'OP02-001::OP02-001_p1').provisional, true);
assert.equal(catalog.variants.find(item => item.variantKey === 'OP03-001::OP03-001').provisional, true);

const mappings = generateVariantMappings({
  dbCatalog: catalog,
  priceCards: [
    { key: 'op01-001', name: 'ロロノア・ゾロ', modelNo: 'OP01-001', imageId: 'https://shop.example/OP01-001.png' },
    { key: 'op01-001@parallel', name: 'ロロノア・ゾロ【パラレル】', modelNo: 'OP01-001', imageId: 'https://shop.example/OP01-001_p1.webp' },
    { key: 'op02-001', name: 'テストカード', modelNo: 'OP02-001', imageId: 'https://shop.example/OP02-001.png' },
    { key: 'op03-001', name: '仮カード', modelNo: 'OP03-001', imageId: 'https://shop.example/OP03-001.png' },
  ],
});

assert.equal(mappings['OP01-001::OP01-001'].priceKey, 'op01-001');
assert.equal(mappings['OP01-001::OP01-001_p1'].priceKey, 'op01-001@parallel');
assert.equal(mappings['OP02-001::OP02-001'].priceKey, 'op02-001');
assert.equal(mappings['OP02-001::OP02-001_p1'], undefined);
assert.equal(mappings['OP03-001::OP03-001'], undefined);

console.log('DB catalog sync tests passed.');
