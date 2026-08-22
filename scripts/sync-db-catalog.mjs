import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCardIdentity } from './lib/card-identity.mjs';
import {
  generateVariantMappings,
  getImageIdentity,
  normalizeCardNumber,
  normalizeVariantType,
  variantKeyFor,
} from './lib/op-tcg-db-collection.mjs';

const DB_RAW_ROOT = 'https://raw.githubusercontent.com/tksaai/OP_TCG_DB/master';
const DEFAULT_CARDS_SOURCE = `${DB_RAW_ROOT}/cards.json`;
const DEFAULT_MANIFEST_SOURCE = `${DB_RAW_ROOT}/image-manifest.json`;
const DEFAULT_PROVISIONAL_SOURCE = `${DB_RAW_ROOT}/provisional-cards.json`;
const runtimeProcess = globalThis.process;

export async function loadJsonSource(location) {
  if (/^https?:\/\//iu.test(location)) {
    const response = await fetch(location, {
      headers: { 'user-agent': 'OP_TCG_PRICE_CHECKER DB catalog sync' },
    });
    if (!response.ok) throw new Error(`DB catalog download failed (${response.status}): ${location}`);
    return response.json();
  }
  return JSON.parse(await readFile(path.resolve(location), 'utf8'));
}

function stableIndex(variant, arrayIndex = 0) {
  const value = Number(variant?.variantIndex);
  return Number.isInteger(value) && value >= 0 ? value : Math.max(0, Number(arrayIndex) || 0);
}

function variantIdFor(cardNumber, index) {
  if (index >= 1000) return `${cardNumber}_r${index - 1000}`;
  if (index > 0) return `${cardNumber}_p${index}`;
  return cardNumber;
}

function imageHashFor(variant, imageHashes) {
  const direct = variant?.dhash || variant?.imageHash || variant?.hash;
  if (typeof direct === 'string' && direct) return direct;
  for (const source of [variant?.sourceUrl, variant?.path, variant?.fallbackPath]) {
    const hashEntry = imageHashes?.[source];
    const value = typeof hashEntry === 'string'
      ? hashEntry
      : hashEntry?.dhash || hashEntry?.imageHash || hashEntry?.hash;
    if (value) return value;
  }
  return '';
}

function identityTagsFor(cardNumber, cardName, variant, index) {
  if (index === 0) return [];
  const hints = [variant?.label, variant?.getInfo].filter(Boolean).map(value => `【${value}】`).join('');
  return parseCardIdentity(`${cardName || ''}${hints}`, cardNumber).tags;
}

function catalogVariant(cardNumber, card, variant, index, imageHashes, provisional = false) {
  const variantId = variantIdFor(cardNumber, index);
  return {
    variantKey: variantKeyFor(cardNumber, variantId),
    cardNumber,
    cardName: variant?.cardName || card?.cardName || '',
    variantId,
    variantType: normalizeVariantType('', variantId),
    variantIndex: index,
    label: variant?.label || (index === 0 ? '通常' : '別イラスト'),
    getInfo: variant?.getInfo || card?.getInfo || '',
    source: variant?.source || (provisional ? 'provisional' : 'official'),
    sourceUrl: variant?.sourceUrl || '',
    path: variant?.path || variant?.imagePath || '',
    fallbackPath: variant?.fallbackPath || variant?.imagePath || '',
    imageHash: imageHashFor(variant, imageHashes) || null,
    identityTags: identityTagsFor(cardNumber, variant?.cardName || card?.cardName, variant, index),
    provisional,
    provisionalUniqueId: provisional ? variant?.provisionalUniqueId || variant?.uniqueId || null : null,
  };
}

function variantIdentities(variant) {
  return [variant?.sourceUrl, variant?.path, variant?.fallbackPath, variant?.imagePath]
    .map(getImageIdentity)
    .filter(Boolean);
}

export function buildDbCatalog(cards, imageManifest, provisionalCards, imageHashes = {}) {
  if (!Array.isArray(cards) || cards.length < 100) throw new Error('OP_TCG_DB cards.json is incomplete.');
  if (!imageManifest?.cards || typeof imageManifest.cards !== 'object') {
    throw new Error('OP_TCG_DB image-manifest.json does not contain cards.');
  }
  if (!Array.isArray(provisionalCards)) throw new Error('OP_TCG_DB provisional-cards.json must be an array.');

  const cardsByNumber = new Map(cards.map(card => [normalizeCardNumber(card?.cardNumber), card]));
  const variants = [];
  const officialByNumber = new Map();

  for (const [rawNumber, rawVariants] of Object.entries(imageManifest.cards)) {
    const cardNumber = normalizeCardNumber(rawNumber);
    if (!cardNumber || !Array.isArray(rawVariants)) continue;
    const card = cardsByNumber.get(cardNumber) || {};
    const officialVariants = rawVariants.map((variant, arrayIndex) => {
      const index = stableIndex(variant, arrayIndex);
      return catalogVariant(cardNumber, card, variant, index, imageHashes, false);
    });
    variants.push(...officialVariants);
    officialByNumber.set(cardNumber, officialVariants);
  }

  const provisionalByNumber = new Map();
  for (const card of provisionalCards) {
    const cardNumber = normalizeCardNumber(card?.cardNumber);
    if (!cardNumber || !(card?.imagePath || card?.provisionalImageUrl)) continue;
    const group = provisionalByNumber.get(cardNumber) || [];
    group.push(card);
    provisionalByNumber.set(cardNumber, group);
  }

  for (const [cardNumber, group] of provisionalByNumber) {
    const officialVariants = officialByNumber.get(cardNumber) || [];
    const usedIdentities = new Set(officialVariants.flatMap(variantIdentities));
    const usedIndexes = new Set(officialVariants.map(variant => variant.variantIndex));
    let hasPrimary = officialVariants.length > 0;
    let nextIndex = 1;

    for (const card of group) {
      const rawVariant = {
        source: 'provisional',
        sourceUrl: card.provisionalImageUrl || '',
        path: card.imagePath || card.provisionalImageUrl || '',
        fallbackPath: card.imagePath || card.provisionalImageUrl || '',
        label: card.seriesTitle ? `仮DB: ${card.seriesTitle}` : '仮DB画像',
        getInfo: card.getInfo || '',
        cardName: card.cardName || '',
        provisionalUniqueId: card.uniqueId || card.imagePath || card.provisionalImageUrl,
      };
      const identities = variantIdentities(rawVariant);
      const officialDuplicate = officialVariants.find(official => (
        identities.some(identity => variantIdentities(official).includes(identity))
      ));
      if (officialDuplicate) continue;
      if (identities.some(identity => usedIdentities.has(identity))) continue;

      let index = 0;
      if (hasPrimary) {
        while (usedIndexes.has(nextIndex)) nextIndex += 1;
        index = nextIndex;
        nextIndex += 1;
      } else {
        hasPrimary = true;
      }
      usedIndexes.add(index);
      identities.forEach(identity => usedIdentities.add(identity));
      variants.push(catalogVariant(cardNumber, card, rawVariant, index, imageHashes, true));
    }
  }

  variants.sort((a, b) => a.cardNumber.localeCompare(b.cardNumber, undefined, { numeric: true })
    || a.variantIndex - b.variantIndex);
  return {
    format: 'op-tcg-db-catalog',
    version: 1,
    generatedAt: imageManifest.generatedAt || null,
    syncedAt: new Date().toISOString(),
    sourceCounts: {
      cards: cards.length,
      manifestCards: Object.keys(imageManifest.cards).length,
      provisionalCards: provisionalCards.length,
    },
    variants,
  };
}

export async function syncDbCatalog(options = {}) {
  const [cards, manifest, provisionalCards, priceCards, imageHashes] = await Promise.all([
    loadJsonSource(options.cardsSource || DEFAULT_CARDS_SOURCE),
    loadJsonSource(options.manifestSource || DEFAULT_MANIFEST_SOURCE),
    loadJsonSource(options.provisionalSource || DEFAULT_PROVISIONAL_SOURCE),
    loadJsonSource(options.priceCardsSource || 'data/cards.json'),
    loadJsonSource(options.imageHashesSource || 'data/image-hashes.json').catch(() => ({})),
  ]);
  const catalog = buildDbCatalog(cards, manifest, provisionalCards, imageHashes);
  const mappings = generateVariantMappings({ dbCatalog: catalog, priceCards, imageHashes });
  const variantMap = {
    format: 'op-tcg-db-variant-map',
    version: 1,
    generatedAt: new Date().toISOString(),
    catalogGeneratedAt: catalog.generatedAt,
    mappings,
  };

  const catalogOutput = path.resolve(options.catalogOutput || 'data/db-catalog.json');
  const mapOutput = path.resolve(options.mapOutput || 'data/db-variant-map.json');
  await Promise.all([
    writeFile(catalogOutput, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8'),
    writeFile(mapOutput, `${JSON.stringify(variantMap, null, 2)}\n`, 'utf8'),
  ]);
  return { catalogOutput, mapOutput, variants: catalog.variants.length, mappings: Object.keys(mappings).length };
}

const isMain = runtimeProcess?.argv?.[1]
  && path.resolve(runtimeProcess.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const result = await syncDbCatalog({
    cardsSource: runtimeProcess.argv[2] || runtimeProcess.env.OP_TCG_DB_CARDS_URL || DEFAULT_CARDS_SOURCE,
    manifestSource: runtimeProcess.argv[3] || runtimeProcess.env.OP_TCG_DB_IMAGE_MANIFEST_URL || DEFAULT_MANIFEST_SOURCE,
    provisionalSource: runtimeProcess.argv[4] || runtimeProcess.env.OP_TCG_DB_PROVISIONAL_URL || DEFAULT_PROVISIONAL_SOURCE,
  });
  console.log(`Synced ${result.variants} DB variants and ${result.mappings} price mappings.`);
}
