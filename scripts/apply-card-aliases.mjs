// card-aliases.json(人手で承認したカード対応表)を cards.json に適用する。
// パーサー(card-identity.mjs)で自動統合できない表記差
// (例: cardrush のイラストレーター表記 vs torecard のセット名表記)だけを
// ここで橋渡しする。

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { cardKeyFor, extractModelCode } from './lib/card-identity.mjs';
import { mergeHistories, mergeShopEntries } from './lib/card-store.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const CARDS_PATH = path.join(ROOT, 'data', 'cards.json');
const ALIASES_PATH = path.join(ROOT, 'data', 'card-aliases.json');

function recomputeBest(card) {
  const entries = Object.entries(card.pricesByShop || {}).filter(([, shop]) => Number(shop.latestPrice || 0) > 0);
  const best = entries.sort((a, b) => Number(b[1].latestPrice || 0) - Number(a[1].latestPrice || 0))[0];
  card.bestShopId = best ? best[0] : '';
  card.latestPrice = best ? Number(best[1].latestPrice || 0) : 0;
  card.imageId = best?.[1]?.imageUrl || card.imageId || '';
  card.history = best ? mergeHistories(card.history || [], best[1].history || []) : card.history || [];
  return card;
}

function findCards(cards, cardsByKey, alias) {
  if (alias.sourceKey && cardsByKey.has(alias.sourceKey)) {
    return [cardsByKey.get(alias.sourceKey)];
  }

  // ショップ名+型番をパースした同一性キーで探す(キー形式変更に追従できる)
  const parsedKey = cardKeyFor(alias.name, alias.modelNo);
  if (cardsByKey.has(parsedKey)) return [cardsByKey.get(parsedKey)];

  // 最後の手段: 名前の完全一致(統合後カードはショップ別 sourceName も見る)
  const aliasModel = extractModelCode(alias.modelNo, alias.name);
  return cards.filter((card) => {
    if (aliasModel && extractModelCode(card.modelNo, card.name) !== aliasModel) return false;
    if (card.name === alias.name) return true;
    return Object.values(card.pricesByShop || {}).some((shop) => shop.sourceName === alias.name);
  });
}

async function main() {
  const cards = JSON.parse(await readFile(CARDS_PATH, 'utf8'));
  const aliases = JSON.parse(await readFile(ALIASES_PATH, 'utf8'));
  const cardsByKey = new Map(cards.map((card) => [card.key, card]));
  const consumedKeys = new Set();
  const merged = [];

  for (const group of aliases) {
    const matchedByKey = new Map();

    // このグループの統合先として過去に作られたカード(履歴の継続性を保つ)
    for (const card of cards) {
      if (card.canonicalId === group.canonicalId) matchedByKey.set(card.key, card);
    }
    for (const alias of group.aliases || []) {
      for (const card of findCards(cards, cardsByKey, alias)) {
        matchedByKey.set(card.key, card);
      }
    }

    const matched = [...matchedByKey.values()];
    if (matched.length < 2) continue;

    // canonicalId を持つカード(=履歴の本体)を先頭にして統合する
    matched.sort((a, b) => (b.canonicalId === group.canonicalId ? 1 : 0) - (a.canonicalId === group.canonicalId ? 1 : 0));

    const base = {
      ...matched[0],
      key: group.canonicalId,
      canonicalId: group.canonicalId,
      aliasKeys: [],
      name: group.canonicalName || matched[0].name,
      modelNo: group.modelNo || matched[0].modelNo,
      pricesByShop: {},
      history: [],
    };

    for (const card of matched) {
      consumedKeys.add(card.key);
      base.aliasKeys.push(card.key, ...(card.aliasKeys || []), `${card.name}_${card.modelNo}`);
      base.history = mergeHistories(base.history, card.history);
      for (const [shopId, shop] of Object.entries(card.pricesByShop || {})) {
        base.pricesByShop[shopId] = mergeShopEntries(base.pricesByShop[shopId], shop);
      }
    }
    base.aliasKeys = [...new Set(base.aliasKeys.filter(Boolean))].filter((key) => key !== base.key);
    merged.push(recomputeBest(base));
  }

  const output = [
    ...merged,
    ...cards.filter((card) => !consumedKeys.has(card.key)),
  ]
    .map(recomputeBest)
    .filter((card) => Number(card.latestPrice || 0) > 0)
    .sort((a, b) => Number(b.latestPrice || 0) - Number(a.latestPrice || 0) || String(a.modelNo).localeCompare(String(b.modelNo), 'ja'));

  await writeFile(CARDS_PATH, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  console.log(`Applied ${merged.length} alias groups. Wrote ${output.length} cards.`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
