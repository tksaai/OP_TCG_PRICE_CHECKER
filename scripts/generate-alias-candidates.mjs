// パーサー(card-identity.mjs)で自動統合しきれなかった「同一カードの可能性が
// 高い組み合わせ」を抽出し、alias-review.html でレビューする候補を生成する。
//
// 同じ型番の中で、価格に影響する確定属性(開封状態・言語・コミパラ等)が一致する
// レコード同士をグループ化する。ショップ固有の語彙(イラストレーター名、
// セット名、背景説明など)だけが異なるものが候補になる。

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { buildCardKey, parseCardIdentity } from './lib/card-identity.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const CARDS_PATH = path.join(ROOT, 'data', 'cards.json');
const CANDIDATES_PATH = path.join(ROOT, 'data', 'alias-candidates.json');

const SHOP_ORDER = ['mercard', 'cardrush', 'torecard'];

// 価格に直結する確定属性。これが一致するレコードだけを同一候補にまとめる。
// ここに無いタグ(illust:*、ショップ固有のセット名・背景説明、promo 等)は
// 語彙差の可能性があるためグループ分けに使わない。
const HARD_TAG_RE =
  /^(?:unopened|opened|serial|zh|en|asia|sea|zh-illust-jp|en-illust-jp|zh-text|en-text|comic|red|secret|cs|cs-set|anniv\d|prb\d*|pre-errata|post-errata|gold|silver|gold-letter|card-only|full-accessories|parallel|sp|leader-parallel|leader-sp|wanted|foil|full-art|autograph|newly-drawn|manga-bg|manga-art|manga-panel)$/;

function hardSignature(tags) {
  const hard = tags.filter((tag) => HARD_TAG_RE.test(tag));
  return hard.length ? hard.join('+') : 'base';
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[【】《》()[\]（）/・:：,\s_-]+/g, '');
}

function similarity(a, b) {
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
    .sort((a, b) => SHOP_ORDER.indexOf(a.shopId) - SHOP_ORDER.indexOf(b.shopId) || a.name.length - b.name.length)[0]
    .name;
}

function candidateScore(records) {
  const shops = new Set(records.map((record) => record.shopId));
  const prices = records.map((record) => record.latestPrice).filter((price) => price > 0);
  const maxPrice = Math.max(...prices);
  const minPrice = Math.min(...prices);
  const priceRatio = minPrice > 0 ? minPrice / maxPrice : 0;
  const names = records.map((record) => record.name);
  let nameScore = 1;

  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      nameScore = Math.min(nameScore, similarity(names[i], names[j]));
    }
  }

  return Math.round(
    Math.min(100, 45 + shops.size * 10 + Math.min(priceRatio, 1) * 25 + nameScore * 10)
  );
}

function flattenCards(cards) {
  const records = [];

  for (const card of cards) {
    // 人手レビュー済み(card-aliases.json で統合済み)のカードは再提案しない
    if (card.canonicalId) continue;
    for (const [shopId, shop] of Object.entries(card.pricesByShop || {})) {
      const name = shop.sourceName || card.name;
      const parsed = parseCardIdentity(name, card.modelNo);
      if (!parsed.modelCode) continue;

      records.push({
        sourceKey: card.key,
        identityKey: buildCardKey(parsed),
        shopId,
        shopName: shop.shopName || shopId,
        name,
        modelNo: card.modelNo,
        modelCode: parsed.modelCode,
        signature: hardSignature(parsed.tags),
        latestPrice: Number(shop.latestPrice || 0),
        imageUrl: shop.imageUrl || card.imageId || '',
      });
    }
  }

  return records;
}

async function main() {
  const cards = JSON.parse(await readFile(CARDS_PATH, 'utf8'));
  const records = flattenCards(cards);
  const grouped = new Map();

  for (const record of records) {
    const key = `${record.modelCode}_${record.signature}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(record);
  }

  const candidates = [];
  for (const [groupKey, groupRecords] of grouped.entries()) {
    const uniqueSourceKeys = new Set(groupRecords.map((record) => record.sourceKey));
    const uniqueIdentityKeys = new Set(groupRecords.map((record) => record.identityKey));
    const uniqueShops = new Set(groupRecords.map((record) => record.shopId));

    // 既に1枚に統合済み(同一キー)のグループは候補にしない
    if (uniqueIdentityKeys.size < 2 || uniqueSourceKeys.size < 2 || uniqueShops.size < 2) continue;

    const [modelCode, ...signatureParts] = groupKey.split('_');
    const recordsForReview = groupRecords
      .slice()
      .sort((a, b) => b.latestPrice - a.latestPrice)
      .slice(0, 8);

    candidates.push({
      candidateId: `candidate_${modelCode}_${signatureParts.join('_')}`.replace(/[^a-zA-Z0-9_-]/g, '_'),
      suggestedCanonicalId: `${modelCode}_${signatureParts.join('_')}`.toUpperCase().replace(/[^a-zA-Z0-9_-]/g, '_'),
      canonicalName: representativeName(recordsForReview),
      modelCode,
      signature: signatureParts.join('_'),
      confidence: candidateScore(recordsForReview),
      maxPrice: Math.max(...recordsForReview.map((record) => record.latestPrice)),
      records: recordsForReview.map((record) => ({
        shopId: record.shopId,
        shopName: record.shopName,
        sourceKey: record.sourceKey,
        name: record.name,
        modelNo: record.modelNo,
        latestPrice: record.latestPrice,
        imageUrl: record.imageUrl,
      })),
    });
  }

  candidates.sort((a, b) => b.maxPrice - a.maxPrice || b.confidence - a.confidence);

  await mkdir(path.dirname(CANDIDATES_PATH), { recursive: true });
  await writeFile(CANDIDATES_PATH, `${JSON.stringify(candidates, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${candidates.length} alias candidates to ${CANDIDATES_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
