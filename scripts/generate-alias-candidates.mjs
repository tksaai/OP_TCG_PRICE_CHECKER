import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const CARDS_PATH = path.join(ROOT, 'data', 'cards.json');
const CANDIDATES_PATH = path.join(ROOT, 'data', 'alias-candidates.json');

const MODEL_RE = /(?:OP|ST|EB|PRB)\d{2}-\d{3}|P-\d{3}/gi;
const SHOP_ORDER = ['mercard', 'cardrush', 'torecard'];

function normalizeText(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[【】《》()[\]（）/・:：,\s_-]+/g, '');
}

function extractModelCode(...values) {
  const text = values.filter(Boolean).join(' ');
  const matches = text.match(MODEL_RE);
  return matches ? matches[matches.length - 1].toUpperCase() : '';
}

function getFlag(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

function extractCsLabel(text) {
  const normalized = String(text || '').normalize('NFKC');
  const explicit = normalized.match(/CS\s*([0-9]{4}|[0-9]{2}-[0-9]{2})/i);
  if (explicit) return `cs${explicit[1].toLowerCase()}`;
  return /チャンピオンシップ|championship/i.test(normalized) ? 'cs' : '';
}

function buildSignature(record) {
  const text = `${record.name} ${record.modelNo}`.normalize('NFKC');
  const flags = [];

  if (getFlag(text, [/未開封/i])) flags.push('unopened');
  if (getFlag(text, [/開封済み|開封品/i])) flags.push('opened');
  if (getFlag(text, [/シリアル|serial/i])) flags.push('serial');
  if (getFlag(text, [/漫画|コミック|comic|スーパーパラレル|super/i])) flags.push('comic');
  if (getFlag(text, [/sp|和柄/i])) flags.push('sp');

  const cs = extractCsLabel(text);
  if (cs) flags.push(cs);

  return flags.sort().join('-') || 'base';
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
    const shops = card.pricesByShop || {};
    for (const [shopId, shop] of Object.entries(shops)) {
      const modelCode = extractModelCode(card.modelNo, card.name);
      if (!modelCode) continue;

      records.push({
        sourceKey: card.key,
        shopId,
        shopName: shop.shopName || shopId,
        name: card.name,
        modelNo: card.modelNo,
        modelCode,
        latestPrice: Number(shop.latestPrice || 0),
        imageUrl: shop.imageUrl || card.imageId || '',
        signature: buildSignature(card),
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
    const uniqueShops = new Set(groupRecords.map((record) => record.shopId));

    if (uniqueSourceKeys.size < 2 || uniqueShops.size < 2) continue;

    const [modelCode, ...signatureParts] = groupKey.split('_');
    const recordsForReview = groupRecords
      .slice()
      .sort((a, b) => b.latestPrice - a.latestPrice)
      .slice(0, 8);

    candidates.push({
      candidateId: `candidate_${modelCode}_${signatureParts.join('_')}`.replace(/[^a-zA-Z0-9_-]/g, '_'),
      suggestedCanonicalId: `${modelCode}_${signatureParts.join('_')}`.toUpperCase(),
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
