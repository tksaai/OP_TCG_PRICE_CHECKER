import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const inlineScripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/giu)]
  .map(match => match[1].trim())
  .filter(Boolean);

assert.ok(inlineScripts.length > 0, 'index.html にインラインスクリプトがありません');
inlineScripts.forEach((source, index) => {
  new vm.Script(source, { filename: `index-inline-${index}.js` });
});

assert.match(html, />CSV読込</u);
assert.match(html, />DB所持JSON読込</u);
assert.match(html, /id="db-import-modal"/u);
assert.match(html, /一致分のみ置き換え（推奨）/u);
assert.match(html, /一致分を加算/u);
assert.match(html, /createUnmatchedExport/u);
assert.match(html, /unmatchedExportToCsv/u);
assert.match(html, /localStorage\.setItem\('onepieceOwnedCounts'/u);

console.log('Index integration tests passed.');
