// data/cards.json から一覧用の data/cards-index.json を生成する。
// scrape-prices.mjs の直後に実行する想定。

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { applyImageFallbacks, buildPriceImageFallbacks } from './lib/card-image-fallbacks.mjs';
import { buildCardsIndex } from './lib/cards-index.mjs';
import { unavailableShopIdsFromReport } from './lib/shop-policy.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const SOURCE_PATH = path.join(ROOT, 'data', 'cards.json');
const OUTPUT_PATH = path.join(ROOT, 'data', 'cards-index.json');
const REPORT_PATH = path.join(ROOT, 'data', 'scrape-report.json');
const DB_CATALOG_PATH = path.join(ROOT, 'data', 'db-catalog.json');
const DB_VARIANT_MAP_PATH = path.join(ROOT, 'data', 'db-variant-map.json');

async function main() {
  const cards = JSON.parse(await readFile(SOURCE_PATH, 'utf8'));
  if (!Array.isArray(cards) || cards.length === 0) {
    throw new Error('data/cards.json を配列として読めませんでした。');
  }

  const [report, dbCatalog, variantMap] = await Promise.all([
    readFile(REPORT_PATH, 'utf8').then((text) => JSON.parse(text)).catch(() => ({ shops: [] })),
    readFile(DB_CATALOG_PATH, 'utf8').then((text) => JSON.parse(text)).catch(() => ({ variants: [] })),
    readFile(DB_VARIANT_MAP_PATH, 'utf8').then((text) => JSON.parse(text)).catch(() => ({ mappings: {} })),
  ]);
  const unavailableShopIds = unavailableShopIdsFromReport(report);
  const priceImageFallbacks = buildPriceImageFallbacks(dbCatalog, variantMap);
  const index = applyImageFallbacks(
    buildCardsIndex(cards, unavailableShopIds),
    priceImageFallbacks,
  );
  // 一覧は毎回まるごと読むので、こちらは整形せず最小サイズで書き出す
  await writeFile(OUTPUT_PATH, `${JSON.stringify(index)}\n`, 'utf8');

  const sourceSize = (await readFile(SOURCE_PATH)).length;
  const indexSize = (await readFile(OUTPUT_PATH)).length;
  console.log(
    `Wrote ${index.length} cards to ${path.relative(ROOT, OUTPUT_PATH)} ` +
    `(${(indexSize / 1048576).toFixed(1)} MB / 元データ ${(sourceSize / 1048576).toFixed(1)} MB, ` +
    `公式画像フォールバック ${index.filter((card) => card.fallbackImageUrl).length} 件)`
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
