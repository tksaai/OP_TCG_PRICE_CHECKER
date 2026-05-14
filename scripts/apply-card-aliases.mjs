import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const CARDS_PATH = path.join(ROOT, 'data', 'cards.json');
const ALIASES_PATH = path.join(ROOT, 'data', 'card-aliases.json');

function upsertHistory(history, rows) {
  const byDate = new Map();
  for (const item of history || []) {
    if (item.date) byDate.set(item.date, Number(item.price || 0));
  }
  for (const item of rows || []) {
    if (item.date) byDate.set(item.date, Number(item.price || 0));
  }
  return [...byDate.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, price]) => ({ date, price }));
}

function recomputeBest(card) {
  const entries = Object.entries(card.pricesByShop || {}).filter(([, shop]) => Number(shop.latestPrice || 0) > 0);
  const best = entries.sort((a, b) => Number(b[1].latestPrice || 0) - Number(a[1].latestPrice || 0))[0];
  card.bestShopId = best ? best[0] : '';
  card.latestPrice = best ? Number(best[1].latestPrice || 0) : 0;
  card.imageId = best?.[1]?.imageUrl || card.imageId || '';
  card.history = best ? upsertHistory(card.history || [], best[1].history || []) : card.history || [];
  return card;
}

function findCard(cardsByKey, alias) {
  if (alias.sourceKey && cardsByKey.has(alias.sourceKey)) return cardsByKey.get(alias.sourceKey);

  for (const card of cardsByKey.values()) {
    if (card.name === alias.name && card.modelNo === alias.modelNo) return card;
  }
  return null;
}

async function main() {
  const cards = JSON.parse(await readFile(CARDS_PATH, 'utf8'));
  const aliases = JSON.parse(await readFile(ALIASES_PATH, 'utf8'));
  const cardsByKey = new Map(cards.map((card) => [card.key, card]));
  const consumedKeys = new Set();
  const merged = [];

  for (const group of aliases) {
    const matched = [];
    for (const alias of group.aliases || []) {
      const card = findCard(cardsByKey, alias);
      if (card) matched.push(card);
    }
    if (matched.length < 2) continue;

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
      for (const [shopId, shop] of Object.entries(card.pricesByShop || {})) {
        const existing = base.pricesByShop[shopId];
        if (!existing || Number(shop.latestPrice || 0) >= Number(existing.latestPrice || 0)) {
          base.pricesByShop[shopId] = shop;
        } else {
          existing.history = upsertHistory(existing.history || [], shop.history || []);
        }
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
