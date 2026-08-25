// scrape-prices.mjs が書いた data/scrape-report.json を見て、
// 取得件数が落ちたショップがあればジョブを失敗させる。
//
// このステップはコミットの「後」に置く。1 店の正規表現が壊れただけで
// 正常に取れた他店の価格まで捨ててしまわないようにしつつ、
// 気づかないまま数週間放置される事故は防ぐ。

import { readFile, appendFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const REPORT_PATH = path.join(ROOT, 'data', 'scrape-report.json');

function formatRow(shop) {
  const status = shop.skipped ? '停止中' : shop.healthy ? 'OK' : 'NG';
  const note = shop.skipped
    ? '取得を停止しています (scrape-prices.mjs の enabled)'
    : shop.error ? `取得失敗: ${shop.error}` : `前回 ${shop.previous} 件`;
  return `| ${shop.name} | ${status} | ${shop.fetched} | ${note} |`;
}

async function writeSummary(lines) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;
  await appendFile(summaryPath, lines.join(String.fromCharCode(10)) + String.fromCharCode(10), 'utf8');
}

async function main() {
  let report;
  try {
    report = JSON.parse(await readFile(REPORT_PATH, 'utf8'));
  } catch (error) {
    throw new Error(`スクレイプ結果を読めませんでした (${REPORT_PATH}): ${error.message}`);
  }

  const shops = Array.isArray(report.shops) ? report.shops : [];
  if (!shops.length) throw new Error('スクレイプ結果にショップが 1 件もありません。');

  await writeSummary([
    `### 買取価格の取得結果 (${report.date})`,
    '',
    '| ショップ | 状態 | 取得件数 | 備考 |',
    '| --- | --- | ---: | --- |',
    ...shops.map(formatRow),
  ]);

  for (const shop of shops) {
    if (shop.skipped) {
      console.log(`--  ${shop.id}: 取得停止中`);
      continue;
    }
    console.log(`${shop.healthy ? 'OK ' : 'NG '} ${shop.id}: ${shop.fetched} 件 (前回 ${shop.previous} 件)`);
  }

  const broken = shops.filter((shop) => !shop.healthy && !shop.skipped);
  if (broken.length) {
    for (const shop of broken) {
      const reason = shop.error
        ? `取得に失敗しました (${shop.error})`
        : `取得件数が前回の半分未満です (${shop.fetched} < ${shop.previous})`;
      console.error(`::error title=${shop.name}::${reason}`);
    }
    throw new Error(`${broken.length} 店の取得結果が異常です。ページ構造の変更を確認してください。`);
  }

  console.log('All shops healthy.');
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
