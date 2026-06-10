// card-identity.mjs の回帰テスト。実データで確認された表記揺れと、
// 人手レビュー(card-aliases.json)で等価と確認済みの組み合わせをフィクスチャにする。
// 実行: node scripts/test-card-identity.mjs

import assert from 'node:assert/strict';
import { cardKeyFor, parseCardIdentity } from './lib/card-identity.mjs';

let passed = 0;

function same(label, a, b) {
  assert.equal(cardKeyFor(a.name, a.modelNo), cardKeyFor(b.name, b.modelNo), `${label}: 同一キーになるべき\n  A=${cardKeyFor(a.name, a.modelNo)}\n  B=${cardKeyFor(b.name, b.modelNo)}`);
  passed += 1;
}

function different(label, a, b) {
  assert.notEqual(cardKeyFor(a.name, a.modelNo), cardKeyFor(b.name, b.modelNo), `${label}: 別キーであるべき (${cardKeyFor(a.name, a.modelNo)})`);
  passed += 1;
}

function hasTags(label, name, modelNo, expected) {
  const { tags } = parseCardIdentity(name, modelNo);
  for (const tag of expected) {
    assert.ok(tags.includes(tag), `${label}: タグ ${tag} が必要 (実際: ${tags.join(', ')})`);
  }
  passed += 1;
}

// --- ベースカード: レアリティ・色・スペース・全半角の揺れはキーに影響しない ---
same('ベースカード mercard vs torecard',
  { name: 'ナミ【R】《赤》', modelNo: 'OP01-016' },
  { name: 'ナミ 【R】【赤】【OP01-016】', modelNo: 'OP01-016' });
same('ベースカード cardrush(名前のみ)',
  { name: 'ナミ', modelNo: 'OP01-016' },
  { name: 'ナミ【R】《赤》', modelNo: 'OP01-016' });
same('全角D vs 半角D + SEC表記揺れ',
  { name: 'モンキー・Ｄ・ルフィ 【シークレット】【緑】【OP13-118】', modelNo: 'OP13-118' },
  { name: 'モンキー・D・ルフィ【SEC】《緑》', modelNo: 'OP13-118' });

// --- パラレル ---
same('パラレル mercard vs torecard',
  { name: 'ナミ【R】【パラレル】《赤》', modelNo: 'OP01-016' },
  { name: 'ナミ 【R】【パラレル】【赤】【OP01-016】', modelNo: 'OP01-016' });
different('パラレルとベースは別',
  { name: 'ナミ 【R】【パラレル】【赤】【OP01-016】', modelNo: 'OP01-016' },
  { name: 'ナミ 【R】【赤】【OP01-016】', modelNo: 'OP01-016' });
different('cardrush イラスト指定パラレルは自動統合しない(レビュー対象)',
  { name: 'ナミ(パラレル/illust:Sunohara/青背景/ウィンク)', modelNo: 'OP01-016' },
  { name: 'ナミ 【R】【パラレル】【赤】【OP01-016】', modelNo: 'OP01-016' });

// --- コミックパラレル(card-aliases.json OP13-118_COMIC で等価確認済み) ---
same('レッドコミパラ torecard vs mercard',
  { name: 'モンキー・Ｄ・ルフィ 【シークレット】【レッドスーパーパラレル】【緑】【OP13-118】', modelNo: 'OP13-118' },
  { name: 'モンキー・D・ルフィ【レッドコミック版パラレル】《緑》', modelNo: 'レッドコミック版パラレルOP13-118' });
same('レッドコミパラ cardrush',
  { name: 'モンキー・Ｄ・ルフィ(レッドパラレル/漫画背景/漫画絵)', modelNo: 'OP13-118' },
  { name: 'モンキー・Ｄ・ルフィ 【シークレット】【レッドスーパーパラレル】【緑】【OP13-118】', modelNo: 'OP13-118' });
same('コミパラ3表記',
  { name: 'モンキー・D・ルフィ(パラレル/漫画背景/漫画絵)', modelNo: 'OP05-119' },
  { name: 'モンキー・D・ルフィ 【シークレット】【パラレル】【スーパーパラレル】【紫】【OP05-119】', modelNo: 'OP05-119' });
same('コミパラ mercard表記',
  { name: 'モンキー・D・ルフィ【コミック版パラレル】《紫》', modelNo: 'OP05-119' },
  { name: 'モンキー・D・ルフィ(パラレル/漫画背景/漫画絵)', modelNo: 'OP05-119' });
different('レッドコミパラと通常コミパラは別',
  { name: 'モンキー・Ｄ・ルフィ(レッドパラレル/漫画背景/漫画絵)', modelNo: 'OP13-118' },
  { name: 'モンキー・Ｄ・ルフィ(パラレル/漫画背景/漫画絵)', modelNo: 'OP13-118' });

// --- チャンピオンシップ(card-aliases.json の8グループで等価確認済みのパターン) ---
same('CS未開封 mercard(modelNoプレフィックス) vs torecard',
  { name: 'サカズキ【プロモ】《黒》未開封', modelNo: 'チャンピオンシップ版OP02-099' },
  { name: 'サカズキ 【SR】【パラレル】【プロモ】【チャンピオンシップ】【未開封】【黒】【OP02-099】', modelNo: 'OP02-099' });
same('CS未開封 torecard 年付き【2026】',
  { name: 'ボア・ハンコック【プロモ】《黄》未開封', modelNo: 'チャンピオンシップ版OP14-112' },
  { name: 'ボア・ハンコック 【SR】【パラレル】【プロモ】【未開封】【チャンピオンシップ】【黄】【OP14-112】【2026】', modelNo: 'OP14-112' });
different('CS未開封と開封済みは別',
  { name: 'モンキー・D・ルフィ 【シークレット】【パラレル】【プロモ】【未開封】【チャンピオンシップ】【緑】【OP13-118】', modelNo: 'OP13-118' },
  { name: 'モンキー・D・ルフィ 【シークレット】【パラレル】【プロモ】【開封済み】【チャンピオンシップ】【緑】【OP13-118】', modelNo: 'OP13-118' });
same('cardrush CS(イラスト・年付き)も統合する(CS景品は1型番1種類)',
  { name: 'モンキー・D・ルフィ(未開封/CS25-26/illust:Makitoshi)', modelNo: 'OP13-118' },
  { name: 'モンキー・D・ルフィ【プロモ】《緑》未開封', modelNo: 'チャンピオンシップ版OP13-118' });
same('CS年表記の揺れ(CS2023)',
  { name: 'モンキー・D・ルフィ(未開封/CS2023/illust:Studio Vigor Co.Ltd)', modelNo: 'ST10-006' },
  { name: 'モンキー・D・ルフィ 【SR】【パラレル】【プロモ】【チャンピオンシップ】【未開封】【赤】【ST10-006】', modelNo: 'ST10-006' });
different('CS未開封と開封済(cardrush表記)は統合しない',
  { name: 'モンキー・D・ルフィ(未開封/CS25-26/illust:Makitoshi)', modelNo: 'OP13-118' },
  { name: 'モンキー・D・ルフィ(CS25-26/illust:Makitoshi)', modelNo: 'OP13-118' });
different('CS景品とチャンピオンシップセット製品は別',
  { name: 'モンキー・D・ルフィ 【パラレル】【プロモ】【チャンピオンシップセット】【未開封】【赤】【P-001】', modelNo: 'P-001' },
  { name: 'モンキー・D・ルフィ 【プロモ】【チャンピオンシップ】【未開封】【赤】【P-001】', modelNo: 'P-001' });

// --- シリアル・開封状態 ---
hasTags('シリアル+未開封+当選通知書', 'ナミ【プロモ】《黄》※当選通知書付き未開封', 'シリアル版OP08-106',
  ['serial', 'unopened', 'prize-letter', 'promo']);
hasTags('開封品+シリアル入り(cardrush)', 'モンキー・D・ルフィ(開封品/シリアル入り)', 'ST01-001',
  ['opened', 'serial']);
different('未開封カードのみ vs 開封済カードのみ',
  { name: 'ナミ(未開封カードのみ/シリアル/漫画絵)', modelNo: 'OP08-106' },
  { name: 'ナミ(開封済カードのみ/シリアル/漫画絵)', modelNo: 'OP08-106' });

// --- 言語・地域 ---
hasTags('中国版 2nd anniversary (mercard)', 'ボア・ハンコック【SR】【パラレル】《青》【中国版 2nd ANNIVERSARY SET】', 'OP07-051',
  ['zh', 'anniv2', 'parallel']);
hasTags('中国限定 1st anniversary (torecard)', 'ナミ 【R】【パラレル】【プロモ】【中国限定 1st ANNIVERSARY SET】【赤】【OP01-016】', 'OP01-016',
  ['zh', 'anniv1', 'parallel']);
different('中国イラスト版日本語仕様は英語版とも中国版とも別',
  { name: 'ルフィ【中国イラスト版日本語仕様2nd ANNIVERSARY SET】', modelNo: 'OP07-051' },
  { name: 'ルフィ【中国版 2nd ANNIVERSARY SET】', modelNo: 'OP07-051' });
different('英語イラスト版日本語仕様 vs English版',
  { name: 'ルフィ【英語イラスト版日本語仕様2nd ANNIVERSARY SET】', modelNo: 'OP07-051' },
  { name: 'ルフィ 【シークレット】【プロモ】【English 2nd ANNIVERSARY SET】【紫】【OP07-051】', modelNo: 'OP07-051' });

// --- 手配書SP / 金銀 / 金文字 ---
same('手配書 torecard vs cardrush',
  { name: 'シャンクス 【SR】【SP】【手配書】【パラレル】【赤】【OP09-004】', modelNo: 'OP09-004' },
  { name: 'シャンクス(パラレル/手配書)', modelNo: 'OP09-004' });
different('金SPと銀SPは別',
  { name: 'シャンクス 【金】【SR】【SP】【パラレル】【赤】【OP09-004】', modelNo: 'OP09-004' },
  { name: 'シャンクス 【銀】【SR】【SP】【パラレル】【赤】【OP09-004】', modelNo: 'OP09-004' });
hasTags('金文字リーダーSP(torecard)', 'モンキー・D・ルフィ 【SP】【紫】【OP05-060】【金文字】【リーダーSP】', 'OP05-060',
  ['gold-letter', 'sp']);

// --- エラッタ・製品区別 ---
hasTags('初版(mercard)', 'モンキー・D・ルフィ【SR】《黄》※初版', 'OP07-109', ['pre-errata']);
hasTags('エラー修正前(cardrush)', 'モンキー・D・ルフィ(背景白模様有り/ エラー修正前/illust:nakamaru)', 'OP07-109', ['pre-errata']);
different('プロモーションパックEX vs プロモーションカードセット',
  { name: 'ナミ 【SR】【パラレル】【プロモ】【プロモーションパックEX】【黄】【OP08-106】', modelNo: 'OP08-106' },
  { name: 'ナミ 【R】【プロモ】【プロモーションカードセット】【赤】【OP01-016】', modelNo: 'OP01-016' });
hasTags('PRB-01再録(torecard)', 'ナミ 【PRB-01】【R】【パラレル】【赤】【OP01-016】', 'OP01-016',
  ['prb01', 'parallel']);
same('BEST2ホイル版(mercard) = PRB-02フォイル(torecard)',
  { name: 'ルフィ【R】【BEST2ホイル版】《赤》', modelNo: 'OP01-016' },
  { name: 'ルフィ 【PRB-02】【R】【フォイル】【赤】【OP01-016】', modelNo: 'OP01-016' });
// 不明トークンは正規化(長音除去)されて保持される
hasTags('フィナーレセット版プレフィックス(mercard)', 'フィナーレセット版トニートニー・チョッパー【C】《赤》', 'ST01-006',
  ['フィナレセット']);

// --- 書き下ろしサイン ---
same('書き下ろしサイン mercard vs torecard',
  { name: 'モンキー・D・ルフィ【書き下ろしサイン入り版】《赤》', modelNo: 'ST01-012' },
  { name: 'モンキー・D・ルフィ 【SR】【書き下ろしサイン】【パラレル】【赤】【ST01-012】', modelNo: 'ST01-012' });
different('書き下ろしサインと書き下ろしは別カード',
  { name: 'モンキー・D・ルフィ 【SR】【書き下ろしサイン】【パラレル】【赤】【ST01-012】', modelNo: 'ST01-012' },
  { name: 'モンキー・D・ルフィ 【SR】【書き下ろし】【パラレル】【赤】【ST01-012】', modelNo: 'ST01-012' });

// --- mercard modelNo の区別情報(青背景/赤背景は別カード: 350万 vs 50万) ---
different('シリアル中国版 青背景 vs 赤背景',
  { name: 'ナミ【プロモ】《赤》【中国版 1st ANNIVERSARY SET】※中国語表記', modelNo: 'シリアル入りOP01-016※青背景【海外版】' },
  { name: 'ナミ【プロモ】《赤》【中国版 1st ANNIVERSARY SET】※中国語表記', modelNo: 'シリアル入りOP01-016※赤背景【海外版】' });
same('modelNo のハイフン揺れ(ドジャース版)',
  { name: 'モンキー・D・ルフィ【プロモ】《多色》未開封　※英語表記', modelNo: 'ドジャース版EB02-010【海外版】' },
  { name: 'モンキー・D・ルフィ【プロモ】《多色》未開封 ※英語表記', modelNo: 'ドジャ-ス版EB02-010【海外版】' });

// --- 型番なし商品(BOX・ドン!!カード)は名前ベースのキー ---
const donKey = cardKeyFor('ドン!!カード(SDキャラ/しらほし&ルフィ)', '-');
assert.ok(donKey.startsWith('name:'), `型番なしは name: キー (実際: ${donKey})`);
passed += 1;
different('ドン!!カードの種類違い',
  { name: 'ドン!!カード(SDキャラ/しらほし&ルフィ)', modelNo: '-' },
  { name: 'ドン!!カード(SDキャラ/チョッパー)', modelNo: '-' });

// --- HTMLエンティティ ---
same('&#39; エンティティの揺れ',
  { name: "モンキー・D・ルフィ 【SR】【パラレル】【プロモ】【ONE PIECE DAY&#39;24】【黄】【OP07-109】", modelNo: 'OP07-109' },
  { name: "モンキー・D・ルフィ 【SR】【パラレル】【プロモ】【ONE PIECE DAY'24】【黄】【OP07-109】", modelNo: 'OP07-109' });

console.log(`OK: ${passed} 件のアサーションに合格`);
