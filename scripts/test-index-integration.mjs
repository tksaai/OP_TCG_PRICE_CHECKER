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

// XSS の回帰防止: ショップ由来の文字列をエスケープせずに埋め込まないこと
assert.doesNotMatch(appJs, /\$\{c\.name\}/u, 'カード名がエスケープなしで HTML に埋め込まれています');
assert.doesNotMatch(appJs, /\$\{c\.modelNo\}/u, '型番がエスケープなしで HTML に埋め込まれています');
assert.doesNotMatch(appJs, /\$\{card\.name\}/u, 'カード名がエスケープなしで HTML に埋め込まれています');
assert.doesNotMatch(appJs, /\$\{shop\.shopName\}/u, 'ショップ名がエスケープなしで HTML に埋め込まれています');
assert.doesNotMatch(appJs, /onchange="[^"]*\$\{/u, 'HTML 属性の中で文字列を連結しています');

console.log('Index integration tests passed.');
