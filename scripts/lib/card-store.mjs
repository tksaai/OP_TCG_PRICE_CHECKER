// cards.json のカード統合・再キー化の共通処理。
// scrape-prices.mjs / apply-card-aliases.mjs / 検証スクリプトで共用する。

import { cardKeyFor } from './card-identity.mjs';

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
