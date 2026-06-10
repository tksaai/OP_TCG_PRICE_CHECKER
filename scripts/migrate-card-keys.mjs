// 旧キー形式(型番_カード名)の cards.json / card-aliases.json を
// 新キー形式(型番@版種タグ, card-identity.mjs)へ一括移行する。
//
// scrape-prices.mjs の normalizePrevious も同じ再キー化を行うため、
// このスクリプトを実行しなくても次回スクレイプ時に自動移行されるが、
// 即座に統合結果を反映したい場合に手動で実行する。
// 実行: node scripts/migrate-card-keys.mjs

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { cardKeyFor } from './lib/card-identity.mjs';
import { mergeHistories, rekeyCards } from './lib/card-store.mjs';

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

async function main() {
  const cards = JSON.parse(await readFile(CARDS_PATH, 'utf8'));
  const rekeyed = rekeyCards(cards);

  const output = [...rekeyed.values()]
    .map(recomputeBest)
    .filter((card) => Number(card.latestPrice || 0) > 0)
    .sort((a, b) => Number(b.latestPrice || 0) - Number(a.latestPrice || 0) || String(a.modelNo).localeCompare(String(b.modelNo), 'ja'));

  await writeFile(CARDS_PATH, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  console.log(`cards.json: ${cards.length} -> ${output.length} 件`);

  // card-aliases.json の sourceKey を新キーに更新する
  // (apply-card-aliases.mjs は name/modelNo からの再導出でも照合できるが、
  //  直接参照を最新化しておく)
  const aliases = JSON.parse(await readFile(ALIASES_PATH, 'utf8'));
  let updated = 0;
  for (const group of aliases) {
    for (const alias of group.aliases || []) {
      const next = cardKeyFor(alias.name, alias.modelNo);
      if (alias.sourceKey !== next) {
        alias.sourceKey = next;
        updated += 1;
      }
    }
  }
  await writeFile(ALIASES_PATH, `${JSON.stringify(aliases, null, 2)}\n`, 'utf8');
  console.log(`card-aliases.json: ${updated} 件の sourceKey を更新`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
