export const DEFAULT_DB_IMAGE_ROOT = 'https://tksaai.github.io/OP_TCG_DB/';

function publicImageUrl(value, root) {
  const source = String(value || '').trim();
  if (!source) return '';
  try {
    return new URL(source, root).href;
  } catch {
    return '';
  }
}

export function buildPriceImageFallbacks(dbCatalog, variantMap, root = DEFAULT_DB_IMAGE_ROOT) {
  const variants = Array.isArray(dbCatalog) ? dbCatalog : dbCatalog?.variants || [];
  const variantsByKey = new Map(variants.map((variant) => [variant?.variantKey, variant]));
  const mappings = variantMap?.mappings || variantMap || {};
  const fallbacks = new Map();

  for (const [variantKey, mapping] of Object.entries(mappings)) {
    const priceKey = typeof mapping === 'string' ? mapping : mapping?.priceKey;
    const variant = variantsByKey.get(variantKey);
    // 仮DB画像は版違いの可能性があるため、自動表示には使わない。
    if (!priceKey || !variant || variant.provisional) continue;
    const imageUrl = publicImageUrl(
      variant.path || variant.fallbackPath || variant.sourceUrl,
      root,
    );
    if (imageUrl && !fallbacks.has(priceKey)) fallbacks.set(priceKey, imageUrl);
  }

  return fallbacks;
}

export function applyImageFallbacks(cardsIndex, fallbacks) {
  return (cardsIndex || []).map((card) => {
    const fallbackImageUrl = fallbacks.get(card?.key) || '';
    if (!fallbackImageUrl) return card;
    return {
      ...card,
      imageId: card.imageId || fallbackImageUrl,
      fallbackImageUrl,
    };
  });
}
