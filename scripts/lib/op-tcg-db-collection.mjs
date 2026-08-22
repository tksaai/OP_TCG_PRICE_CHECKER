import { extractModelCode, parseCardIdentity } from './card-identity.mjs';

export const COLLECTION_FORMAT = 'op-tcg-db-collection';
export const COLLECTION_VERSION = 1;
export const IMPORT_MODE_REPLACE_MATCHED = 'replace-matched';
export const IMPORT_MODE_ADD = 'add';

const IMAGE_EXT_RE = /\.(?:avif|gif|jpe?g|png|webp)$/iu;
const RESTRICTED_AUTO_TAGS = new Set([
  'unopened', 'opened', 'prize-letter', 'ship-letter', 'full-accessories', 'card-only',
  'serial', 'zh', 'en', 'asia', 'sea', 'zh-text', 'en-text', 'zh-illust-jp', 'en-illust-jp',
]);

export function normalizeCardNumber(value) {
  const text = String(value || '').normalize('NFKC').trim().toUpperCase();
  const match = text.match(/(?:OP|ST|EB|PRB)\d{2}-\d{3}|P-\d{3}/u);
  return match?.[0] || '';
}

export function normalizeVariantType(value, variantId = '') {
  if (value === 'normal' || value === 'alternate-art' || value === 'alternate-rarity') return value;
  if (/_r\d+$/iu.test(variantId)) return 'alternate-rarity';
  if (/_p\d+$/iu.test(variantId)) return 'alternate-art';
  return 'normal';
}

export function variantKeyFor(cardNumber, variantId) {
  const normalizedNumber = normalizeCardNumber(cardNumber);
  const normalizedVariant = String(variantId || normalizedNumber).normalize('NFKC').trim();
  return `${normalizedNumber}::${normalizedVariant}`;
}

export function validateCollectionPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('DB所持JSONのルートはオブジェクトである必要があります。');
  }
  if (payload.format !== COLLECTION_FORMAT) {
    throw new Error(`対応していない形式です。format は "${COLLECTION_FORMAT}" である必要があります。`);
  }
  if (!Number.isInteger(payload.version)) {
    throw new Error('DB所持JSONのversionが不正です。');
  }
  if (payload.version > COLLECTION_VERSION) {
    throw new Error(`DB所持JSON version ${payload.version} は未対応です。対応上限は ${COLLECTION_VERSION} です。`);
  }
  if (payload.version < 1) {
    throw new Error(`DB所持JSON version ${payload.version} は対応していません。`);
  }
  if (!Array.isArray(payload.items)) {
    throw new Error('DB所持JSONにitems配列がありません。');
  }

  const items = payload.items.map((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error(`items[${index}] が不正です。`);
    }
    const cardNumber = normalizeCardNumber(item.cardNumber);
    if (!cardNumber) throw new Error(`items[${index}].cardNumber が不正です。`);
    const variantId = String(item.variantId || '').normalize('NFKC').trim();
    if (!variantId) throw new Error(`items[${index}].variantId がありません。`);
    const count = Number(item.count);
    if (!Number.isInteger(count) || count < 0) {
      throw new Error(`items[${index}].count は0以上の整数である必要があります。`);
    }
    const id = String(item.id || variantKeyFor(cardNumber, variantId));
    if (id !== variantKeyFor(cardNumber, variantId)) {
      throw new Error(`items[${index}].id と cardNumber/variantId が一致しません。`);
    }
    return {
      ...item,
      id,
      cardNumber,
      variantId,
      variantType: normalizeVariantType(item.variantType, variantId),
      count,
    };
  });

  return { ...payload, items };
}

export function priceKeyFor(card) {
  return String(card?.canonicalId || card?.key || `${card?.name || ''}_${card?.modelNo || ''}`);
}

export function getImageIdentity(value) {
  const source = String(value || '').trim();
  if (!source) return '';
  try {
    const url = new URL(source, 'https://local.invalid/');
    return decodeURIComponent(url.pathname.split('/').pop() || '')
      .replace(IMAGE_EXT_RE, '')
      .toLowerCase();
  } catch {
    return source.split(/[?#]/u)[0].split('/').pop().replace(IMAGE_EXT_RE, '').toLowerCase();
  }
}

function hashValue(value) {
  if (typeof value === 'string') return value;
  return value?.dhash || value?.imageHash || value?.hash || '';
}

function cardImageUrls(card) {
  return [...new Set([
    card?.imageId,
    ...Object.values(card?.pricesByShop || {}).map(shop => shop?.imageUrl),
  ].filter(Boolean))];
}

export function buildPriceIndex(priceCards, imageHashes = {}) {
  const byKey = new Map();
  const byNumber = new Map();

  for (const card of Array.isArray(priceCards) ? priceCards : []) {
    const priceKey = priceKeyFor(card);
    const parsed = parseCardIdentity(card?.name, card?.modelNo);
    const cardNumber = normalizeCardNumber(parsed.modelCode || extractModelCode(card?.modelNo, card?.name));
    if (!priceKey || !cardNumber) continue;
    const images = cardImageUrls(card);
    const entry = {
      card,
      priceKey,
      cardNumber,
      tags: [...parsed.tags].sort(),
      images,
      imageIdentities: new Set(images.map(getImageIdentity).filter(Boolean)),
      imageHashes: new Set(images.map(image => hashValue(imageHashes?.[image])).filter(Boolean)),
    };
    byKey.set(priceKey, entry);
    const candidates = byNumber.get(cardNumber) || [];
    candidates.push(entry);
    byNumber.set(cardNumber, candidates);
  }

  return { byKey, byNumber };
}

function mappingTable(source) {
  if (!source) return {};
  if (source.mappings && typeof source.mappings === 'object' && !Array.isArray(source.mappings)) {
    return source.mappings;
  }
  return typeof source === 'object' && !Array.isArray(source) ? source : {};
}

function mappingFor(source, variantKey) {
  const raw = mappingTable(source)[variantKey];
  if (typeof raw === 'string') return { priceKey: raw };
  return raw && typeof raw === 'object' ? raw : null;
}

function catalogVariantMap(dbCatalog) {
  const variants = Array.isArray(dbCatalog) ? dbCatalog : dbCatalog?.variants;
  return new Map((variants || []).map(variant => [variant.variantKey, variant]));
}

function sameTags(a, b) {
  const left = [...new Set(a || [])].sort();
  const right = [...new Set(b || [])].sort();
  return left.length === right.length && left.every((tag, index) => tag === right[index]);
}

function automaticCandidateAllowed(variantType, candidate, expectedTags = []) {
  const expected = new Set(expectedTags || []);
  if (candidate.tags.some(tag => RESTRICTED_AUTO_TAGS.has(tag) && !expected.has(tag))) return false;
  if (variantType === 'normal') return candidate.tags.length === 0;
  return candidate.tags.length > 0;
}

function resolveMappedCandidate(mapping, priceIndex, cardNumber, provisional) {
  if (!mapping?.priceKey) return null;
  if (provisional && !['manual', 'image-hash', 'image-path'].includes(mapping.confirmedBy || 'manual')) return null;
  const candidate = priceIndex.byKey.get(mapping.priceKey);
  if (!candidate || candidate.cardNumber !== cardNumber) return null;
  return candidate;
}

function candidateSummary(candidate) {
  return {
    priceKey: candidate.priceKey,
    name: candidate.card?.name || '',
    modelNo: candidate.card?.modelNo || candidate.cardNumber,
    tags: candidate.tags,
  };
}

function matchOneItem(item, context) {
  const { priceIndex, manualAliases, variantMap, variantsByKey } = context;
  const variantKey = variantKeyFor(item.cardNumber, item.variantId);
  const dbVariant = variantsByKey.get(variantKey) || null;
  const provisional = Boolean(dbVariant?.provisional);
  const candidates = priceIndex.byNumber.get(item.cardNumber) || [];

  const manualMapping = mappingFor(manualAliases, variantKey);
  const manualCandidate = resolveMappedCandidate(
    manualMapping ? { confirmedBy: 'manual', ...manualMapping } : null,
    priceIndex,
    item.cardNumber,
    provisional
  );
  if (manualCandidate) return matched(item, manualCandidate, 'manual-alias', dbVariant);

  const generatedMapping = mappingFor(variantMap, variantKey);
  const generatedCandidate = resolveMappedCandidate(generatedMapping, priceIndex, item.cardNumber, provisional);
  if (generatedCandidate) return matched(item, generatedCandidate, 'generated-map', dbVariant);

  const dbHash = hashValue(dbVariant?.imageHash || dbVariant?.dhash || dbVariant?.hash);
  if (dbHash) {
    const hashCandidates = candidates.filter(candidate => (
      candidate.imageHashes.has(dbHash)
      && automaticCandidateAllowed(normalizeVariantType(item.variantType, item.variantId), candidate, dbVariant?.identityTags)
    ));
    if (hashCandidates.length === 1) return matched(item, hashCandidates[0], 'image-hash', dbVariant);
    if (hashCandidates.length > 1) return ambiguous(item, hashCandidates, 'image-hash-multiple', dbVariant);
  }

  const expectedTags = Array.isArray(dbVariant?.identityTags) ? dbVariant.identityTags : [];
  const variantType = normalizeVariantType(item.variantType, item.variantId);
  if (!provisional && (variantType === 'normal' || expectedTags.length > 0)) {
    const tagCandidates = candidates.filter(candidate => sameTags(candidate.tags, expectedTags));
    if (tagCandidates.length === 1) return matched(item, tagCandidates[0], 'variant-tags', dbVariant);
    if (tagCandidates.length > 1) return ambiguous(item, tagCandidates, 'variant-tags-multiple', dbVariant);
  }

  if (!provisional && variantType === 'normal' && candidates.length === 1
    && automaticCandidateAllowed(variantType, candidates[0], expectedTags)) {
    return matched(item, candidates[0], 'unique-card-number', dbVariant);
  }

  if (provisional) {
    return unmatched(item, 'provisional-unconfirmed', dbVariant, candidates);
  }
  if (candidates.length > 1) return ambiguous(item, candidates, 'card-number-multiple', dbVariant);
  return unmatched(item, candidates.length ? 'variant-unconfirmed' : 'card-number-not-found', dbVariant, candidates);
}

function matched(item, candidate, method, dbVariant) {
  return {
    status: 'matched', item, method, dbVariant,
    priceKey: candidate.priceKey,
    priceCard: candidateSummary(candidate),
    candidates: [candidateSummary(candidate)],
  };
}

function ambiguous(item, candidates, reason, dbVariant) {
  return {
    status: 'ambiguous', item, reason, dbVariant,
    candidates: candidates.map(candidateSummary),
  };
}

function unmatched(item, reason, dbVariant, candidates = []) {
  return {
    status: 'unmatched', item, reason, dbVariant,
    candidates: candidates.map(candidateSummary),
  };
}

export function matchCollectionPayload(payload, resources = {}) {
  const validated = validateCollectionPayload(payload);
  const priceIndex = buildPriceIndex(resources.priceCards, resources.imageHashes);
  const variantsByKey = catalogVariantMap(resources.dbCatalog);
  const activeItems = validated.items.filter(item => item.count > 0);
  const results = activeItems.map(item => matchOneItem(item, {
    priceIndex,
    variantsByKey,
    manualAliases: resources.manualAliases,
    variantMap: resources.variantMap,
  }));

  const matchesByKey = new Map();
  for (const result of results.filter(result => result.status === 'matched')) {
    const current = matchesByKey.get(result.priceKey) || {
      priceKey: result.priceKey,
      count: 0,
      items: [],
      priceCard: result.priceCard,
    };
    current.count += result.item.count;
    current.items.push(result.item);
    matchesByKey.set(result.priceKey, current);
  }

  const matched = results.filter(result => result.status === 'matched');
  const ambiguous = results.filter(result => result.status === 'ambiguous');
  const unmatchedItems = results.filter(result => result.status === 'unmatched');
  return {
    payload: validated,
    results,
    matches: [...matchesByKey.values()],
    ambiguous,
    unmatched: unmatchedItems,
    unresolved: [...ambiguous, ...unmatchedItems],
    summary: {
      totalCards: activeItems.reduce((sum, item) => sum + item.count, 0),
      totalKinds: activeItems.length,
      matchedKinds: matched.length,
      matchedCards: matched.reduce((sum, result) => sum + result.item.count, 0),
      ambiguousKinds: ambiguous.length,
      unmatchedKinds: unmatchedItems.length,
    },
  };
}

export function applyCollectionMatches(existingCounts, matches, mode = IMPORT_MODE_REPLACE_MATCHED) {
  if (![IMPORT_MODE_REPLACE_MATCHED, IMPORT_MODE_ADD].includes(mode)) {
    throw new Error(`未対応の反映方法です: ${mode}`);
  }
  const output = { ...(existingCounts || {}) };
  for (const match of matches || []) {
    if (!match?.priceKey) continue;
    const count = Math.max(0, Number(match.count) || 0);
    output[match.priceKey] = mode === IMPORT_MODE_ADD
      ? Math.max(0, Number(output[match.priceKey]) || 0) + count
      : count;
  }
  return output;
}

export function createUnmatchedExport(matchResult) {
  return {
    format: 'op-tcg-price-checker-unmatched-collection',
    version: 1,
    source: {
      format: matchResult?.payload?.format || COLLECTION_FORMAT,
      version: matchResult?.payload?.version || COLLECTION_VERSION,
      appVersion: matchResult?.payload?.appVersion || null,
      exportedAt: matchResult?.payload?.exportedAt || null,
    },
    generatedAt: new Date().toISOString(),
    items: (matchResult?.unresolved || []).map(result => ({
      ...result.item,
      matchStatus: result.status,
      reason: result.reason,
      candidates: result.candidates,
      manualMappingKey: result.item.id,
      manualMappingOptions: result.candidates.map(candidate => ({
        priceKey: candidate.priceKey,
        confirmedBy: 'manual',
      })),
    })),
  };
}

function csvCell(value) {
  const text = String(value ?? '');
  return `"${text.replaceAll('"', '""')}"`;
}

export function unmatchedExportToCsv(matchResult) {
  const rows = [['cardNumber', 'cardName', 'variantId', 'variantType', 'count', 'status', 'reason', 'candidateKeys']];
  for (const result of matchResult?.unresolved || []) {
    rows.push([
      result.item.cardNumber,
      result.item.cardName || '',
      result.item.variantId,
      result.item.variantType,
      result.item.count,
      result.status,
      result.reason,
      result.candidates.map(candidate => candidate.priceKey).join('|'),
    ]);
  }
  return `\uFEFF${rows.map(row => row.map(csvCell).join(',')).join('\n')}\n`;
}

export function generateVariantMappings({ dbCatalog, priceCards, imageHashes = {} }) {
  const priceIndex = buildPriceIndex(priceCards, imageHashes);
  const mappings = {};
  const variants = Array.isArray(dbCatalog) ? dbCatalog : dbCatalog?.variants || [];

  for (const variant of variants) {
    const candidates = priceIndex.byNumber.get(variant.cardNumber) || [];
    if (!candidates.length) continue;
    let selected = null;
    let method = '';
    let confirmedBy = '';

    const dbHash = hashValue(variant.imageHash || variant.dhash || variant.hash);
    if (dbHash) {
      const matches = candidates.filter(candidate => (
        candidate.imageHashes.has(dbHash)
        && automaticCandidateAllowed(normalizeVariantType(variant.variantType, variant.variantId), candidate, variant.identityTags)
      ));
      if (matches.length === 1) {
        [selected] = matches;
        method = 'image-hash';
        confirmedBy = 'image-hash';
      }
    }

    if (!selected) {
      const identities = new Set([
        getImageIdentity(variant.sourceUrl),
        getImageIdentity(variant.path),
        getImageIdentity(variant.fallbackPath),
      ].filter(Boolean));
      const matches = identities.size
        ? candidates.filter(candidate => (
            [...identities].some(identity => candidate.imageIdentities.has(identity))
            && automaticCandidateAllowed(normalizeVariantType(variant.variantType, variant.variantId), candidate, variant.identityTags)
          ))
        : [];
      if (matches.length === 1) {
        [selected] = matches;
        method = 'image-path';
        confirmedBy = 'image-path';
      }
    }

    const variantType = normalizeVariantType(variant.variantType, variant.variantId);
    if (!selected && !variant.provisional && variantType === 'normal') {
      const matches = candidates.filter(candidate => candidate.tags.length === 0);
      if (matches.length === 1) {
        [selected] = matches;
        method = 'normal-variant-tags';
        confirmedBy = 'variant-tags';
      }
    }

    if (!selected && !variant.provisional && Array.isArray(variant.identityTags) && variant.identityTags.length) {
      const matches = candidates.filter(candidate => sameTags(candidate.tags, variant.identityTags));
      if (matches.length === 1) {
        [selected] = matches;
        method = 'variant-tags';
        confirmedBy = 'variant-tags';
      }
    }

    if (!selected && !variant.provisional && variantType === 'normal' && candidates.length === 1
      && automaticCandidateAllowed(variantType, candidates[0], variant.identityTags)) {
      [selected] = candidates;
      method = 'unique-card-number';
      confirmedBy = 'unique-card-number';
    }

    if (selected) {
      mappings[variant.variantKey] = {
        priceKey: selected.priceKey,
        method,
        confirmedBy,
        cardNumber: variant.cardNumber,
        variantId: variant.variantId,
      };
    }
  }

  return mappings;
}
