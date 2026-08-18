// 自動統合できなかった同一カード候補を、人が安全に確認できる形で出力する。
// 画像は店舗によって公式サンプルと実物写真が混在するため、名寄せ判定には使わず参考値だけを出す。

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildCardKey, parseCardIdentity } from './lib/card-identity.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CARDS_PATH = path.join(ROOT, 'data', 'cards.json');
const CANDIDATES_PATH = path.join(ROOT, 'data', 'alias-candidates.json');
const IMAGE_HASHES_PATH = path.join(ROOT, 'data', 'image-hashes.json');

const SHOP_ORDER = ['mercard', 'cardrush', 'torecard'];

// 値が違えば同じ候補に入れない属性。
// 開封状態、言語・地域、カード種別、大会・配布区分、付属品の有無を画像より優先する。
export const HARD_TAG_RE =
  /^(?:unopened|opened|serial|zh|en|asia|sea|zh-illust-jp|en-illust-jp|zh-text|en-text|comic|red|secret|cs|cs-set|judge|flagship|promo|anniv\d|prb\d*|pre-errata|post-errata|gold|silver|gold-letter|black-gold-letter|prize-letter|ship-letter|card-only|full-accessories|parallel|sp|leader-parallel|leader-sp|wanted|foil|full-art|autograph|newly-drawn|manga-bg|manga-art|manga-panel)$/;

export function hardSignature(tags) {
  const hard = tags.filter((tag) => HARD_TAG_RE.test(tag));
  return hard.length ? hard.join('+') : 'base';
}

export function hardTagsFromAliasKeys(card, modelCode) {
  const prefix = `${String(modelCode).toLowerCase()}@`;
  const tagSets = (card.aliasKeys || [])
    .map((key) => String(key).toLowerCase())
    .filter((key) => key.startsWith(prefix))
    .map((key) => key.slice(prefix.length).split('+').filter((tag) => HARD_TAG_RE.test(tag)))
    .filter((tags) => tags.length);
  if (!tagSets.length) return [];

  const signatures = new Set(tagSets.map((tags) => [...tags].sort().join('+')));
  return signatures.size === 1 ? [...tagSets[0]].sort() : [];
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[「」『』【】()[\]（）・:：\s_-]+/g, '');
}

export function similarity(a, b) {
  const left = new Set(normalizeText(a).match(/.{1,2}/g) || []);
  const right = new Set(normalizeText(b).match(/.{1,2}/g) || []);
  if (!left.size || !right.size) return 0;
  const intersection = [...left].filter((token) => right.has(token)).length;
  const union = new Set([...left, ...right]).size;
  return intersection / union;
}

function representativeName(records) {
  return records
    .slice()
    .sort(
      (a, b) =>
        SHOP_ORDER.indexOf(a.shopId) - SHOP_ORDER.indexOf(b.shopId) ||
        a.name.length - b.name.length
    )[0].name;
}

export function hammingSimilarity(hexA, hexB) {
  if (!hexA || !hexB || hexA.length !== hexB.length) return null;
  let distance = 0;
  for (let i = 0; i < hexA.length; i += 8) {
    let xor = parseInt(hexA.slice(i, i + 8), 16) ^ parseInt(hexB.slice(i, i + 8), 16);
    while (xor) {
      distance += xor & 1;
      xor >>>= 1;
    }
  }
  return 1 - distance / (hexA.length * 4);
}

// 店舗をまたぐ全組み合わせを集計する。最大値だけでなく中央値・最小値も残す。
// 同一画像でも写真の撮り方で値が下がり、別カードでも公式サンプル画像の流用で値が上がり得る。
export function imageAnalysisFor(records, imageHashes = {}) {
  const scores = [];
  const hashedRecords = records.filter((record) => imageHashes[record.imageUrl]?.dhash).length;

  for (let i = 0; i < records.length; i++) {
    for (let j = i + 1; j < records.length; j++) {
      if (records[i].shopId === records[j].shopId) continue;
      const left = imageHashes[records[i].imageUrl]?.dhash;
      const right = imageHashes[records[j].imageUrl]?.dhash;
      const score = hammingSimilarity(left, right);
      if (score != null) scores.push(Math.round(score * 100));
    }
  }

  scores.sort((a, b) => a - b);
  if (!scores.length) {
    return { max: null, median: null, min: null, pairCount: 0, hashedRecords, totalRecords: records.length };
  }

  const middle = Math.floor(scores.length / 2);
  const median = scores.length % 2
    ? scores[middle]
    : Math.round((scores[middle - 1] + scores[middle]) / 2);

  return {
    max: scores.at(-1),
    median,
    min: scores[0],
    pairCount: scores.length,
    hashedRecords,
    totalRecords: records.length,
  };
}

function candidateMetrics(records) {
  const shops = new Set(records.map((record) => record.shopId));
  const prices = records.map((record) => record.latestPrice).filter((price) => price > 0);
  const maxPrice = prices.length ? Math.max(...prices) : 0;
  const minPrice = prices.length ? Math.min(...prices) : 0;
  const priceRatio = minPrice > 0 ? maxPrice / minPrice : null;
  const names = records.map((record) => record.name);
  let nameScore = 1;

  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      nameScore = Math.min(nameScore, similarity(names[i], names[j]));
    }
  }

  // これは「同一カードの信頼度」ではなくレビュー順を決める候補度。
  // 価格は同一カードでも店舗・状態・更新状況で大きく変わるため、ごく小さい重みに留める。
  const priceCloseness = priceRatio ? 1 / priceRatio : 0;
  const candidateScore = Math.round(
    Math.min(100, 40 + Math.min(shops.size, 3) * 10 + nameScore * 25 + priceCloseness * 5)
  );

  return {
    candidateScore,
    nameScore: Math.round(nameScore * 100),
    priceStats: {
      min: minPrice,
      max: maxPrice,
      ratio: priceRatio == null ? null : Number(priceRatio.toFixed(1)),
    },
  };
}

function reviewRiskFor(records, imageStats, priceStats) {
  const shopCounts = new Map();
  records.forEach((record) => shopCounts.set(record.shopId, (shopCounts.get(record.shopId) || 0) + 1));
  const duplicateShops = [...shopCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([shopId, count]) => ({ shopId, count }));

  const conditions = new Set(
    records.flatMap((record) => record.tags.filter((tag) => tag === 'opened' || tag === 'unopened'))
  );
  const conditionConflict = conditions.size > 1;
  const imageMixed =
    imageStats.max != null && imageStats.min != null && imageStats.max >= 90 && imageStats.min <= 70;
  const tinyOrStoppedPrice = priceStats.min > 0 && priceStats.min < 100 && priceStats.max >= 1000;
  const meaningfulPriceSpread =
    priceStats.min >= 500 && priceStats.ratio != null && priceStats.ratio >= 5;
  const duplicateWithSpread =
    duplicateShops.length > 0 && priceStats.ratio != null && priceStats.ratio >= 3;

  const warnings = [];
  if (conditionConflict) warnings.push('開封済み・未開封が混在');
  if (duplicateShops.length) {
    warnings.push(`同一店舗の複数商品を含む（${duplicateShops.map((item) => `${item.shopId} ${item.count}件`).join('、')}）`);
  }
  if (meaningfulPriceSpread || duplicateWithSpread) {
    warnings.push(`価格差 約${priceStats.ratio}倍（価格は参考情報）`);
  }
  if (tinyOrStoppedPrice) warnings.push('1～99円の停止・仮価格を含む可能性');
  if (imageMixed) warnings.push('画像類似度に幅あり（公式画像・実物写真・版違いを確認）');
  if (!imageStats.pairCount) warnings.push('店舗間の画像比較データなし');

  let riskLevel = 'low';
  if (conditionConflict || meaningfulPriceSpread || duplicateWithSpread) riskLevel = 'high';
  else if (duplicateShops.length || imageMixed || tinyOrStoppedPrice) riskLevel = 'medium';

  return { riskLevel, warnings, duplicateShops, conditionConflict };
}

export function flattenCards(cards) {
  const records = [];

  for (const card of cards) {
    if (card.canonicalId) continue;
    for (const [shopId, shop] of Object.entries(card.pricesByShop || {})) {
      const name = shop.sourceName || card.name;
      const parsed = parseCardIdentity(name, card.modelNo);
      if (!parsed.modelCode) continue;
      const recoveredHardTags = hardTagsFromAliasKeys(card, parsed.modelCode);
      const tags = recoveredHardTags.length
        ? [...new Set([...parsed.tags.filter((tag) => !HARD_TAG_RE.test(tag)), ...recoveredHardTags])].sort()
        : parsed.tags;

      records.push({
        sourceKey: card.key,
        identityKey: buildCardKey(parsed),
        shopId,
        shopName: shop.shopName || shopId,
        name,
        modelNo: card.modelNo,
        modelCode: parsed.modelCode,
        tags,
        signature: hardSignature(tags),
        latestPrice: Number(shop.latestPrice || 0),
        imageUrl: shop.imageUrl || card.imageId || '',
      });
    }
  }

  return records;
}

export function generateAliasCandidates(cards, imageHashes = {}) {
  const grouped = new Map();
  for (const record of flattenCards(cards)) {
    const key = `${record.modelCode}_${record.signature}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(record);
  }

  const candidates = [];
  for (const [groupKey, groupRecords] of grouped.entries()) {
    const uniqueSourceKeys = new Set(groupRecords.map((record) => record.sourceKey));
    const uniqueIdentityKeys = new Set(groupRecords.map((record) => record.identityKey));
    const uniqueShops = new Set(groupRecords.map((record) => record.shopId));
    if (uniqueIdentityKeys.size < 2 || uniqueSourceKeys.size < 2 || uniqueShops.size < 2) continue;

    const separator = groupKey.indexOf('_');
    const modelCode = groupKey.slice(0, separator);
    const signature = groupKey.slice(separator + 1);
    const recordsForReview = groupRecords
      .slice()
      .sort((a, b) => b.latestPrice - a.latestPrice)
      .slice(0, 8);
    const imageStats = imageAnalysisFor(recordsForReview, imageHashes);
    const metrics = candidateMetrics(recordsForReview);
    const risk = reviewRiskFor(recordsForReview, imageStats, metrics.priceStats);

    candidates.push({
      candidateId: `candidate_${modelCode}_${signature}`.replace(/[^a-zA-Z0-9_-]/g, '_'),
      suggestedCanonicalId: `${modelCode}_${signature}`.toUpperCase().replace(/[^a-zA-Z0-9_-]/g, '_'),
      canonicalName: representativeName(recordsForReview),
      modelCode,
      signature,
      candidateScore: metrics.candidateScore,
      confidence: metrics.candidateScore,
      nameScore: metrics.nameScore,
      imageScore: imageStats.max,
      imageStats,
      priceStats: metrics.priceStats,
      maxPrice: metrics.priceStats.max,
      riskLevel: risk.riskLevel,
      warnings: risk.warnings,
      duplicateShops: risk.duplicateShops,
      conditionConflict: risk.conditionConflict,
      records: recordsForReview.map((record) => ({
        shopId: record.shopId,
        shopName: record.shopName,
        sourceKey: record.sourceKey,
        identityKey: record.identityKey,
        name: record.name,
        modelNo: record.modelNo,
        tags: record.tags,
        latestPrice: record.latestPrice,
        imageUrl: record.imageUrl,
      })),
    });
  }

  const riskOrder = { high: 0, medium: 1, low: 2 };
  candidates.sort(
    (a, b) =>
      riskOrder[a.riskLevel] - riskOrder[b.riskLevel] ||
      b.maxPrice - a.maxPrice ||
      b.candidateScore - a.candidateScore
  );
  return candidates;
}

export async function writeAliasCandidates() {
  const cards = JSON.parse(await readFile(CARDS_PATH, 'utf8'));
  const imageHashes = await readFile(IMAGE_HASHES_PATH, 'utf8')
    .then((text) => JSON.parse(text))
    .catch(() => ({}));
  const candidates = generateAliasCandidates(cards, imageHashes);
  await mkdir(path.dirname(CANDIDATES_PATH), { recursive: true });
  await writeFile(CANDIDATES_PATH, `${JSON.stringify(candidates, null, 2)}\n`, 'utf8');
  return candidates;
}

const runtimeProcess = globalThis.process;
const isMain = runtimeProcess?.argv?.[1]
  ? path.resolve(runtimeProcess.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isMain) {
  writeAliasCandidates()
    .then((candidates) => console.log(`Wrote ${candidates.length} alias candidates to ${CANDIDATES_PATH}`))
    .catch((error) => {
      console.error(error);
      runtimeProcess.exitCode = 1;
    });
}
