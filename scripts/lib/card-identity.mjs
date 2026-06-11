// カードの同一性判定モジュール。
// ショップごとに表記が揺れる商品名から「型番 + 版種タグ」を抽出し、
// 表記に依存しない決定的なキーを生成する。
//
// 方針:
// - 型番(OP01-001 等)があるカードは、キーにカード名を含めない。
//   名前の揺れ(全角/半角、レアリティ表記、色表記、スペース)はキーに影響しない。
// - 版種(パラレル/未開封/シリアル/言語など)はショップ間で共通の正規化タグに変換する。
// - 解釈できないトークン(イラストレーター名、背景説明、独自のセット名など)は
//   正規化したうえでタグとして残す。「不明なもの同士を誤って統合する」ことを防ぎ、
//   ショップ間の橋渡しは人手レビュー(alias-review.html → card-aliases.json)に委ねる。
//   例: mercard の modelNo「シリアル入りOP01-016※青背景」の「青背景」は
//   別イラストの高額カードを区別する情報なので、捨てずにタグ化する。
//
// ルールは上から順に適用され、マッチした部分文字列はトークンから取り除かれる
// (例:「英語イラスト版日本語仕様2nd ANNIVERSARY SET」は en-illust-jp を消費した後、
//  残りから anniv2 を拾う。汎用の「英語」ルールには到達しない)。

const MODEL_RE = /(?:OP|ST|EB|PRB)\d{2}-\d{3}|P-\d{3}/gi;

// 同一視してよいことが確認済みの共通語彙 → 正規化タグ。長いパターンを先に置く。
const TOKEN_RULES = [
  // 言語・地域
  [/中国イラスト版日本語仕様/u, ['zh-illust-jp']],
  [/英語イラスト版日本語仕様/u, ['en-illust-jp']],
  // 「※中国語表記」は中国版セット内の中国語テキスト版を区別する(価格差が大きい)
  [/中国語表記/u, ['zh-text']],
  [/英語表記/u, ['en-text']],
  [/中国(?:版|限定|語)|^china$/iu, ['zh']],
  [/英語(?:版)?|^english$/iu, ['en']],
  [/southeast\s*asian/iu, ['sea']],
  [/for\s*asia|asiaロゴ有|^(?:asia|アジア)(?:版)?$/iu, ['asia']],
  [/for\s*japan|^japan$/iu, ['jp']],

  // 開封状態・付属品
  [/未開封/u, ['unopened']],
  [/開封(?:済み?|品)/u, ['opened']],
  [/当選通知書付き/u, ['prize-letter']],
  [/発送通知書付き/u, ['ship-letter']],
  [/付属品完備/u, ['full-accessories']],
  [/カードのみ/u, ['card-only']],
  [/シリアル(?:入り|版)?|^serial$/iu, ['serial']],

  // コミックパラレル系(3店の人手エイリアスで等価性確認済み):
  //   cardrush「パラレル/漫画背景/漫画絵」= torecard「スーパーパラレル」
  //   = mercard「コミック版パラレル」
  [/レッド(?=(?:スーパー|コミック版)?パラレル)/u, ['red']],
  // \s* はレッド消費後の挿入スペースを許容する
  // (「コミック版レッドパラレル」→ red 消費後「コミック版 パラレル」)
  [/スーパー\s*パラレル|コミック版\s*パラレル|コミパラ/u, ['comic']],
  [/漫画背景/u, ['manga-bg']],
  [/漫画絵/u, ['manga-art']],
  [/原作コマパラレル/u, ['manga-panel', 'parallel']],

  // パラレル・特殊加工
  // 金文字リーダーSP: torecard【金文字】【リーダーSP】= mercard 金箔リーダーパラレル
  // = cardrush(金文字/アニメイラスト)。finalizeTags で gold-letter に集約する
  [/金箔リーダーパラレル/u, ['gold-letter']],
  [/リーダーパラレル/u, ['leader-parallel']],
  [/リーダーsp/iu, ['leader-sp']],
  // mercard「PRBパラレル」は PRB-01 を指す(vol.2 は「BEST2ホイル版」と書き分けている)
  [/prbパラレル/iu, ['prb01', 'parallel']],
  [/spパラレル/iu, ['sp', 'parallel']],
  [/^sp$|spカード/iu, ['sp']],
  // 五老星の赤文字版: torecard「レッドパラレル」= mercard「特別パラレル」
  [/特別パラレル/u, ['red', 'parallel']],
  [/パラレル(?:加工版?)?/u, ['parallel']],
  [/手配書/u, ['wanted']],
  [/黒金文字/u, ['black-gold-letter']],
  [/金文字/u, ['gold-letter']],
  [/^金$/u, ['gold']],
  [/^銀$/u, ['silver']],
  [/フルアート/u, ['full-art']],
  // 「書き下ろしサイン」(1M超)と「書き下ろし」(数万円)は別カード
  [/書き下ろしサイン(?:入り)?/u, ['autograph']],
  [/書き下ろし/u, ['newly-drawn']],
  [/best2ホイル版?/iu, ['prb02', 'foil']],
  [/foil(?:仕様)?|ホイル|フォイル/iu, ['foil']],
  [/^prb-?(\d{2})$/iu, (m) => [`prb${m[1]}`]],

  // シークレット:
  // - 単独(他にレアリティ表記なし)なら SEC レアリティの言い換え → ノイズ
  // - 【シークレット】【R】のように別レアリティと併記される場合は
  //   「シークレット版」という別カードの版種を意味する(中国版アニバーサリー等)
  [/シークレット版/u, ['secret']],
  [/^シークレット$/u, ['~secret']],

  // エラッタ(初版=エラー修正前は mercard/cardrush の表記対応から)
  [/(?:エラー)?修正前|^初版$/u, ['pre-errata']],
  [/(?:エラー)?修正後/u, ['post-errata']],

  // イベント・プロモ
  [/公認ジャッジ|^judge$/iu, ['judge']],
  [/チャンピオンシップセット/u, ['cs-set']],
  [/チャンピオンシップ|championship|^cs$|^cs\d{2}(?:-\d{2})?$|^cs\d{4}$/iu, ['cs']],
  [/フラッグシップ(?:バトル)?/u, ['flagship']],
  [/(\d)(?:st|nd|rd|th)\s*anniversary/iu, (m) => [`anniv${m[1]}`]],
  [/^プロモ$/u, ['promo']],
];

// 明示的なレアリティ文字。捨てるが「~rarity」マーカーを残す
// (シークレット併記時の判定に使う)。
const RARITY_LETTER_RE = /^(?:r|sr|uc|c|l|tr)$/iu;

// 単独トークンとして現れた場合に捨てるノイズ(レアリティ・色・年号など)。
const DROP_TOKEN_RES = [
  /^(?:sec|p|リーダー|レア)$/iu,
  /^[赤青緑紫黒黄]{1,2}$/u,
  /^多色$/u,
  /^(?:19|20)\d{2}$/,
  /^['’]\d{2}$/,
];

// ST型番のカードに付くスタートデッキ/アルティメットデッキ名は出自そのもので
// 冗長(torecard だけが付記し、mercard/cardrush は書かない)。
// ファミリーデッキ等の別製品再録タグは区別情報なので残す。
// (実データ検証: ST型番で複数種のデッキタグを持つのは ST01 のファミリーデッキのみ)
const ST_REDUNDANT_DECK_RE = /^(?:スタトデッキ|アルティメットデッキ)/u;

// 名前の括弧外末尾に付く版種表記(mercard「《緑》未開封」「※当選通知書付き開封品」等)。
const TRAILING_RE =
  /(?:※[^※]*|未開封|開封済み?|開封品|for\s*(?:japan|asia)|asia|japan)\s*$/iu;

export function decodeEntities(value) {
  return String(value || '')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"');
}

export function extractModelCode(...values) {
  for (const value of values) {
    const matches = String(value || '')
      .normalize('NFKC')
      .match(MODEL_RE);
    if (matches) return matches[matches.length - 1].toUpperCase();
  }
  return '';
}

// 不明トークンの正規化: 空白・記号・長音記号の揺れを潰した小文字表記。
function normalizeUnknownToken(token) {
  return String(token || '')
    .toLowerCase()
    .replace(/[\s.\-–—_'’!?！？☆★※。、,，:：&()（）『』「」・]+/gu, '')
    .replace(/ー/gu, '')
    .replace(/^版|(?:版|仕様)$/u, '');
}

// ルールを順に適用し、マッチ部分を取り除いた残りを返す。
function applyTokenRules(text, tags) {
  let rest = text.trim();
  for (const [re, result] of TOKEN_RULES) {
    const m = rest.match(re);
    if (!m) continue;
    for (const tag of typeof result === 'function' ? result(m) : result) {
      tags.add(tag);
    }
    rest = `${rest.slice(0, m.index)} ${rest.slice(m.index + m[0].length)}`.trim();
    if (!rest) break;
  }
  return rest;
}

// トークン1つを処理する。共通語彙に該当しない残りは正規化タグとして保持。
function consumeToken(rawToken, tags) {
  const token = String(rawToken || '').replace(MODEL_RE, ' ').trim();
  if (!token) return;
  if (RARITY_LETTER_RE.test(token)) {
    tags.add('~rarity');
    return;
  }
  if (DROP_TOKEN_RES.some((re) => re.test(token))) return;
  const illust = token.match(/^i?l?lust[:：]\s*(.+)$/iu);
  if (illust) {
    tags.add(`illust:${normalizeUnknownToken(illust[1])}`);
    return;
  }
  const rest = applyTokenRules(token, tags);
  const leftover = normalizeUnknownToken(rest);
  if (leftover.length >= 2) tags.add(leftover);
}

// 括弧(【】《》()[]『』「」)の中身をトークンとして処理し、括弧外のテキストを返す。
function consumeBrackets(text, tags) {
  return text.replace(
    /【([^】]*)】|《([^》]*)》|\(([^)]*)\)|（([^）]*)）|\[([^\]]*)\]|『([^』]*)』|「([^」]*)」/gu,
    (_, ...groups) => {
      const content = groups.slice(0, 7).find((g) => g != null) || '';
      for (const token of content.split(/[/・,、]/u)) consumeToken(token, tags);
      return ' ';
    }
  );
}

function finalizeTags(tags) {
  // 「Japan/ForJapan」は3ショップとも無印(デフォルト)と同義なので冗長。
  // 地域の区別は asia / zh / en 側のタグだけで成立する。
  // (mercard は同一カードを時期により ForJapan 付き/無しで改名しており、
  //  jp を落とすことで旧名の残骸リスティングも正しく統合される)
  tags.delete('jp');

  // シークレット単独は SEC レアリティの言い換え(捨てる)。
  // 【R】等と併記された場合のみ「シークレット版」という版種として扱う。
  if (tags.has('~secret')) {
    tags.delete('~secret');
    if (tags.has('~rarity')) tags.add('secret');
  }
  tags.delete('~rarity');

  // 漫画背景/漫画絵 とパラレルの組み合わせはコミックパラレル
  if (tags.has('manga-bg') && tags.has('manga-art')) {
    tags.add('comic');
    tags.delete('manga-bg');
    tags.delete('manga-art');
  }
  // 上位の版種が付いたら汎用の parallel は冗長
  // (torecard は【書き下ろしサイン】【パラレル】のように併記する)
  if (tags.has('comic') || tags.has('leader-parallel') || tags.has('autograph')) {
    tags.delete('parallel');
  }
  // 金文字リーダーSP は gold-letter に集約:
  //   torecard: SP+金文字+リーダーSP / mercard: 金箔リーダーパラレル+SPOPxx『EByy』
  //   / cardrush: 金文字+アニメイラスト → すべて gold-letter のみ
  if (tags.has('gold-letter')) {
    tags.delete('sp');
    tags.delete('leader-sp');
    tags.delete('leader-parallel');
    tags.delete('アニメイラスト');
    for (const tag of [...tags]) {
      if (/^(?:op|st|eb|prb)\d{2}$/.test(tag)) tags.delete(tag);
    }
  }
  // フラッグシップ景品も CS と同様、本質的にパラレル(torecard のみ付記する)
  if (tags.has('flagship')) {
    tags.delete('parallel');
  }
  // 公認ジャッジ景品: mercard は【プロモ】※JUDGE、cardrush は (JUDGE) のみ
  if (tags.has('judge')) {
    tags.delete('promo');
  }
  // 手配書(指名手配書デザインのSP)は torecard が【SP】【パラレル】、
  // cardrush が「パラレル」を併記するが、手配書自体が版種を確定する
  if (tags.has('wanted')) {
    tags.delete('parallel');
    tags.delete('sp');
  }
  // チャンピオンシップ景品は本質的にパラレルかつプロモなので表記差を吸収
  // (torecard は【パラレル】【プロモ】を付け、mercard は【プロモ】のみ等)。
  // cardrush だけが付ける illust:* も落とす: CS景品は1型番につき1種類しか
  // 存在しないことを実データ全39型番で確認済み(イラスト違いの併存なし)
  if (tags.has('cs')) {
    tags.delete('parallel');
    tags.delete('promo');
    for (const tag of [...tags]) {
      if (tag.startsWith('illust:')) tags.delete(tag);
    }
  }
  return [...tags].sort();
}

export function parseCardIdentity(rawName, rawModelNo) {
  const tags = new Set();
  const name = decodeEntities(rawName).normalize('NFKC');
  const modelNoText = decodeEntities(rawModelNo)
    .normalize('NFKC')
    .replace(/^型(?:番)?[:：\s]*/u, '');

  const modelCode = extractModelCode(modelNoText, name);

  // modelNo 側の付加情報を処理する。mercard は「チャンピオンシップ版OP13-118」
  // 「シリアル入りOP01-016※青背景【海外版】」のように版種・区別情報を付けるほか、
  // 型番なし商品(ドン!!カード等)では modelNo がそのまま種類の説明になっている。
  const modelOutside = consumeBrackets(modelNoText.replace(MODEL_RE, ' '), tags);
  // ※ 区切りでトークン化(空白では区切らない: 「2nd ANNIVERSARY SET」等を壊さない)
  for (const chunk of modelOutside.split(/※/u)) consumeToken(chunk, tags);

  // 名前の括弧内トークンを処理し、括弧外をベース名として残す
  const outside = consumeBrackets(name.replace(MODEL_RE, ' '), tags);

  // 括弧外末尾の版種表記(「《緑》未開封」「※当選通知書付き開封品」等)を剥がす
  let baseName = outside.replace(/\s+/gu, ' ').trim();
  for (let m; (m = baseName.match(TRAILING_RE)) && m[0].trim(); ) {
    consumeToken(m[0].replace(/^※/u, ''), tags);
    baseName = baseName.slice(0, m.index).trim();
  }

  // 先頭の「〜版」プレフィックス(mercard「フィナーレセット版チョッパー」等)
  const leading = baseName.match(/^([^\s【《(（]{3,12}版)(?=[ぁ-んァ-ヶ一-龠a-zA-Z])/u);
  if (leading) {
    consumeToken(leading[1], tags);
    baseName = baseName.slice(leading[1].length).trim();
  }

  const finalTags = finalizeTags(tags);

  // ST型番には自デッキ名タグが冗長に付くことがある(torecard のみ)
  const cleanedTags = modelCode.startsWith('ST')
    ? finalTags.filter((tag) => !ST_REDUNDANT_DECK_RE.test(tag))
    : finalTags;

  return { modelCode, baseName, tags: cleanedTags };
}

export function buildCardKey(parsed) {
  const tagPart = parsed.tags.length ? `@${parsed.tags.join('+')}` : '';
  if (parsed.modelCode) return `${parsed.modelCode.toLowerCase()}${tagPart}`;
  return `name:${normalizeUnknownToken(parsed.baseName)}${tagPart}`;
}

export function cardKeyFor(name, modelNo) {
  return buildCardKey(parseCardIdentity(name, modelNo));
}
