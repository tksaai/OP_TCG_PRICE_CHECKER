import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const appJs = await readFile(new URL('../app.js', import.meta.url), 'utf8');

// アプリ本体は app.js に切り出してある (CSP script-src 'self' のため)
new vm.Script(appJs, { filename: 'app.js' });
assert.match(html, /<script src="app\.js" defer><\/script>/u, 'index.html が app.js を読み込んでいません');

// インラインスクリプトとインラインハンドラが残っていないこと
const inlineScripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/giu)]
  .map(match => match[1].trim())
  .filter(Boolean);
assert.equal(inlineScripts.length, 0, 'index.html にインラインスクリプトが残っています');
assert.doesNotMatch(html, /\son(?:click|change|input|submit|load|error)=/u, 'index.html にインラインイベントハンドラが残っています');

// CSP と、外部ホストへの依存が無いこと
assert.match(html, /http-equiv="Content-Security-Policy"/u, 'CSP の meta タグがありません');
assert.match(html, /script-src 'self'/u, 'CSP の script-src が self に絞られていません');
assert.doesNotMatch(html, /cdnjs\.cloudflare\.com/u, 'Chart.js が CDN 参照のままです');
assert.doesNotMatch(html, /img\.icons8\.com/u, 'アイコンが外部ホスト参照のままです');
assert.match(html, /<script src="vendor\/chart\.min\.js"><\/script>/u, '同梱した Chart.js を読み込んでいません');

// 画面に必要な要素
assert.match(html, />CSV読込</u);
assert.match(html, />DB所持JSON読込</u);
assert.match(html, /id="db-import-modal"/u);
assert.match(html, /一致分のみ置き換え（推奨）/u);
assert.match(html, /一致分を加算/u);

// data-action は必ず app.js 側に対応する分岐があること
const actions = [...html.matchAll(/data-action="([^"]+)"/gu)].map(match => match[1]);
assert.ok(actions.length > 0, 'data-action が 1 つもありません');
for (const action of new Set(actions)) {
  assert.ok(appJs.includes(`case '${action}':`), `data-action="${action}" に対応する処理が app.js にありません`);
}

// app.js 側の機能
assert.match(appJs, /createUnmatchedExport/u);
assert.match(appJs, /unmatchedExportToCsv/u);
assert.match(appJs, /localStorage\.setItem\('onepieceOwnedCounts'/u);

// XSS の回帰防止: HTML を組み立てている箇所に、ショップ由来の文字列を
// エスケープせず埋め込んでいないこと (textContent や CSV への出力は対象外)
const rawTextField = /\$\{(?:c|card|shop|entry|item)\.(?:name|modelNo|shopName|sourceName|cardName)\b/u;
const htmlBlocks = [...appJs.matchAll(/(?:innerHTML\s*=|Html\s*\+?=|insertAdjacentHTML\([^,]+,)\s*`([\s\S]*?)`/gu)]
  .map(match => match[1]);
assert.ok(htmlBlocks.length > 0, 'HTML を組み立てている箇所が見つかりません');
for (const block of htmlBlocks) {
  assert.doesNotMatch(
    block,
    rawTextField,
    `HTML にエスケープなしの値を埋め込んでいます: ${block.match(rawTextField)?.[0]}`
  );
}
assert.doesNotMatch(appJs, /onchange="[^"]*\$\{/u, 'HTML 属性の中で文字列を連結しています');
assert.match(appJs, /escapeHtml\(c\.name\)/u, 'カード名がエスケープされていません');

// CSV は数式として解釈されないようにしてから書き出すこと
assert.match(appJs, /function csvCell\(/u, 'CSV 出力のエスケープ関数がありません');
assert.doesNotMatch(appJs, /csvContent \+= `"\$\{card\.name\}/u, 'CSV にカード名を素で書き出しています');

console.log('Index integration tests passed.');
