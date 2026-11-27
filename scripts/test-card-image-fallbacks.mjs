import assert from 'node:assert/strict';
import { applyImageFallbacks, buildPriceImageFallbacks } from './lib/card-image-fallbacks.mjs';

const catalog = {
  variants: [
    {
      variantKey: 'OP01-001::OP01-001_p1',
      path: 'CardsWebP/OP01/official/OP01-001_p1.webp',
      provisional: false,
    },
    {
      variantKey: 'OP01-002::OP01-002_p1',
      path: 'Cards/Provisional/OP01-002.jpg',
      provisional: true,
    },
  ],
};
const variantMap = {
  mappings: {
    'OP01-001::OP01-001_p1': { priceKey: 'op01-001@parallel' },
    'OP01-002::OP01-002_p1': { priceKey: 'op01-002@parallel' },
  },
};

const fallbacks = buildPriceImageFallbacks(catalog, variantMap, 'https://db.example/app/');
assert.equal(
  fallbacks.get('op01-001@parallel'),
  'https://db.example/app/CardsWebP/OP01/official/OP01-001_p1.webp',
);
assert.equal(fallbacks.has('op01-002@parallel'), false, '仮DB画像を自動表示しない');

const enriched = applyImageFallbacks([
  { key: 'op01-001@parallel', imageId: '' },
  { key: 'op01-001@parallel', imageId: 'https://shop.example/card.jpg' },
  { key: 'op01-999', imageId: '' },
], fallbacks);
assert.equal(enriched[0].imageId, fallbacks.get('op01-001@parallel'));
assert.equal(enriched[0].fallbackImageUrl, fallbacks.get('op01-001@parallel'));
assert.equal(enriched[1].imageId, 'https://shop.example/card.jpg', 'ショップ画像を優先する');
assert.equal(enriched[1].fallbackImageUrl, fallbacks.get('op01-001@parallel'));
assert.equal(enriched[2].fallbackImageUrl, undefined);

console.log('Card image fallback tests passed.');
