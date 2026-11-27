// cards.json のカード統合・再キー化の共通処理。
// scrape-prices.mjs / apply-card-aliases.mjs / 検証スクリプトで共用する。

import { cardKeyFor, decodeEntities, parseCardIdentity } from './card-identity.mjs';

// 2つの履歴を日付単位で統合してソートする。
export function mergeHistories(a, b) {
  const byDate = new Map();
  for (const rows of [a, b]) {
    for (const item of rows || []) {
      if (item?.date) byDate.set(item.date, Number(item.price || 0));
    }
  }
  return [...byDate.entries()]
    .sort(([x], [y]) => x.localeCompare(y))
    .map(([date, price]) => ({ date, price }));
}

function lastDate(history) {
  const rows = history || [];
  return rows.length ? rows[rows.length - 1].date || '' : '';
}

// 同一ショップのエントリ2つを統合する。履歴は和集合、最新値はより新しい方を採る。
export function mergeShopEntries(a, b) {
  if (!a) return b;
  if (!b) return a;
  const [older, newer] = lastDate(a.history) <= lastDate(b.history) ? [a, b] : [b, a];
  return {
    ...older,
    ...newer,
    history: mergeHistories(older.history, newer.history),
  };
}

function preferName(a, b) {
  if (a.canonicalId && a.name) return a.name;
  if (b.canonicalId && b.name) return b.name;
  if (!a.name) return b.name || '';
  if (!b.name) return a.name;
  // 表示にはより簡潔な方を使う(torecard の冗長な名前を避ける)
  return a.name.length <= b.name.length ? a.name : b.name;
}

function cleanerModelNo(a, b) {
  // mercard は modelNo に版種プレフィックスを付けるため、純粋な型番を優先する
  const isClean = (v) => /^(?:OP|ST|EB|PRB)\d{2}-\d{3}$|^P-\d{3}$/i.test(String(v || ''));
  if (isClean(a)) return a;
  if (isClean(b)) return b;
  return a || b || '';
}

// 同一カードと判定された2件を1件に統合する。
export function mergeCards(a, b) {
  const pricesByShop = { ...(a.pricesByShop || {}) };
  for (const [shopId, entry] of Object.entries(b.pricesByShop || {})) {
    pricesByShop[shopId] = mergeShopEntries(pricesByShop[shopId], entry);
  }
  const aliasKeys = new Set([
    ...(a.aliasKeys || []),
    ...(b.aliasKeys || []),
    a.key,
    b.key,
  ]);
  const merged = {
    ...b,
    ...a,
    name: preferName(a, b),
    modelNo: cleanerModelNo(a.modelNo, b.modelNo),
    canonicalId: a.canonicalId || b.canonicalId || undefined,
    imageId: a.imageId || b.imageId || '',
    pricesByShop,
    history: mergeHistories(a.history, b.history),
    aliasKeys: [...aliasKeys].filter(Boolean),
  };
  if (!merged.canonicalId) delete merged.canonicalId;
  return merged;
}

function legacyKey(card) {
  return `${card.name}_${card.modelNo}`;
}

// 旧形式の cards.json を新キーで Map 化する。キー衝突 = 同一カードとして統合。
// 旧キーは aliasKeys に保持し、フロントエンドの localStorage 移行を機能させる。
export function rekeyCards(rawCards) {
  const map = new Map();
  for (const card of Array.isArray(rawCards) ? rawCards : []) {
    const key = cardKeyFor(card.name, card.modelNo);
    const oldKeys = [card.key, legacyKey(card)].filter((k) => k && k !== key);
    const pricesByShop = card.pricesByShop || {
      mercard: {
        shopName: 'メルカード',
        latestPrice: Number(card.latestPrice || 0),
        imageUrl: card.imageId || '',
        history: Array.isArray(card.history) ? card.history : [],
      },
    };
    const next = {
      ...card,
      key,
      pricesByShop,
      history: Array.isArray(card.history) ? card.history : [],
      aliasKeys: [...new Set([...(card.aliasKeys || []), ...oldKeys])],
    };
    map.set(key, map.has(key) ? withKey(mergeCards(map.get(key), next), key) : next);
  }
  return map;
}

function withKey(card, key) {
  card.key = key;
  card.aliasKeys = (card.aliasKeys || []).filter((k) => k !== key);
  return card;
}

function normalizeShopProductText(value) {
  return decodeEntities(value)
    .normalize('NFKC')
    .replace(/\s+/gu, ' ')
    .trim();
}

function latestShopDate(card) {
  let latest = '';
  for (const entry of Object.values(card.pricesByShop || {})) {
    const date = lastDate(entry?.history);
    if (date > latest) latest = date;
  }
  return latest;
}

// 店舗の商品名・画像・カード番号が完全に一致する場合は、店舗側の型番説明が
// 後から変わって正規化キーだけが分裂した同一商品とみなす。
// 画像だけでは開封/未開封や通常/SPにも使い回されるため、画像単独では統合しない。
function shopProductFingerprints(card) {
  const { modelCode } = parseCardIdentity(card.name, card.modelNo);
  const modelPart = modelCode || 'no-model';
  const fingerprints = [];
  for (const [shopId, entry] of Object.entries(card.pricesByShop || {})) {
    const sourceName = normalizeShopProductText(entry?.sourceName);
    const imageUrl = String(entry?.imageUrl || '').trim();
    if (!sourceName || !imageUrl) continue;
    fingerprints.push({
      key: `${shopId}\u0000${modelPart}\u0000${sourceName}\u0000${imageUrl}`,
      sourceName,
    });
  }
  return fingerprints;
}

function hasCompatibleShopVariant(a, b, sourceName) {
  const aTags = new Set(parseCardIdentity(a.name, a.modelNo).tags);
  const bTags = new Set(parseCardIdentity(b.name, b.modelNo).tags);
  const difference = new Set([
    ...[...aTags].filter((tag) => !bTags.has(tag)),
    ...[...bTags].filter((tag) => !aTags.has(tag)),
  ]);
  if (difference.size === 0) return true;

  // 過去に適用したショップ間aliasの有無だけで同一店舗の商品が二重化したデータ。
  if ([...difference].every((tag) => tag === 'flagship')) return true;

  // 四皇トレジャーゲットキャンペーンは、店舗が後から収録弾(OP17)を説明欄へ
  // 追記した。同じ商品名・画像・カード番号なら同一商品として履歴を継続する。
  const description = `${sourceName} ${a.modelNo || ''} ${b.modelNo || ''}`;
  if (/四皇トレジャーゲットキャンペーン/u.test(description)
      && [...difference].every((tag) => tag === 'op17')) return true;

  return false;
}

// 同一店舗の商品が、説明欄(modelNo)の変更だけで別キーになったケースを統合する。
// 最新の店舗掲載を本体にし、古いキーは aliasKeys と履歴へ残す。
export function dedupeSameShopProducts(rawCards) {
  const cards = Array.isArray(rawCards) ? rawCards : [...(rawCards?.values?.() || [])];
  const parent = cards.map((_, index) => index);
  const find = (index) => {
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]];
      index = parent[index];
    }
    return index;
  };
  const union = (a, b) => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent[rootB] = rootA;
  };

  const byFingerprint = new Map();
  cards.forEach((card, index) => {
    for (const fingerprint of shopProductFingerprints(card)) {
      const previous = byFingerprint.get(fingerprint.key) || [];
      for (const otherIndex of previous) {
        if (hasCompatibleShopVariant(card, cards[otherIndex], fingerprint.sourceName)) {
          union(index, otherIndex);
        }
      }
      previous.push(index);
      byFingerprint.set(fingerprint.key, previous);
    }
  });

  const groups = new Map();
  cards.forEach((card, index) => {
    const root = find(index);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(card);
  });

  const output = new Map();
  for (const group of groups.values()) {
    group.sort((a, b) => latestShopDate(b).localeCompare(latestShopDate(a)));
    const key = group[0].key || cardKeyFor(group[0].name, group[0].modelNo);
    let merged = group[0];
    for (const card of group.slice(1)) merged = mergeCards(merged, card);
    merged = withKey(merged, key);
    output.set(key, output.has(key) ? withKey(mergeCards(output.get(key), merged), key) : merged);
  }
  return output;
}
