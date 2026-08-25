// 一覧表示用の軽量インデックスを組み立てる。
//
// data/cards.json は全カードの全履歴を持つため 20MB 超になる。起動時にそれを
// 読むと、通信量よりも「展開後の JSON をパースしてメモリに置く」コストが重い。
// 一覧で必要なのは最新価格と前日比・週間比・最安最高だけなので、履歴を畳んで
// 事前計算した値だけを配る。履歴が要る画面 (価格グラフ・資産推移) は、その時
// 点で cards.json を遅延読み込みする。

/** 履歴の最終日を返す (履歴が無ければ空文字) */
function lastDateOf(history) {
  return history.length ? String(history[history.length - 1].date || '') : '';
}

/**
 * データ全体の最新日 (全ショップ・全カードを通じた最終更新日)。
 * 「前日比」はこの日に更新されたカードにだけ出す。更新が止まったショップの
 * 1 か月前の変動を当日の値動きとして見せないための判定に使う。
 */
export function latestDateOf(cards) {
  let latest = '';
  for (const card of cards) {
    for (const shop of Object.values(card?.pricesByShop || {})) {
      const date = lastDateOf(shop?.history || []);
      if (date && date > latest) latest = date;
    }
  }
  return latest;
}

/**
 * 1 ショップ分の履歴を、一覧表示に必要な数値へ畳む。
 * 計算式は app.js の prepareTrendData と同じものを使う。
 */
export function summarizeHistory(history, latestPrice, globalLatestDate) {
  const entries = Array.isArray(history) ? history : [];
  const prices = entries.map((entry) => Number(entry.price) || 0);
  const summary = {
    trendDiff: 0,
    trendPercent: 0,
    weeklyDiff: 0,
    weeklyPercent: 0,
    minPrice: prices.length ? Math.min(...prices) : 0,
    maxPrice: prices.length ? Math.max(...prices) : 0,
    lastDate: lastDateOf(entries),
  };
  if (!entries.length) return summary;

  const last = entries[entries.length - 1];
  if (last.date === globalLatestDate && entries.length >= 2) {
    const prev = entries[entries.length - 2];
    summary.trendDiff = last.price - prev.price;
    if (prev.price > 0) summary.trendPercent = (summary.trendDiff / prev.price) * 100;
  }

  if (globalLatestDate) {
    const target = new Date(globalLatestDate);
    target.setDate(target.getDate() - 7);
    const hasWeekly = entries.some((entry) => new Date(entry.date) > target);
    if (hasWeekly && entries.length >= 2) {
      const weekAgo = [...entries].reverse().find((entry) => new Date(entry.date) <= target) || entries[0];
      const price = Number(latestPrice || last.price || 0);
      summary.weeklyDiff = price - weekAgo.price;
      if (weekAgo.price > 0) summary.weeklyPercent = (summary.weeklyDiff / weekAgo.price) * 100;
    }
  }

  return summary;
}

/** cards.json (履歴つき) から一覧用インデックスを作る */
export function buildCardsIndex(cards) {
  const list = Array.isArray(cards) ? cards : [];
  const globalLatestDate = latestDateOf(list);

  return list.map((card) => {
    const pricesByShop = {};
    for (const [shopId, shop] of Object.entries(card?.pricesByShop || {})) {
      pricesByShop[shopId] = {
        shopName: shop.shopName || '',
        // sourceName は「マージなし」表示でショップ別の名前を出すのに使う
        sourceName: shop.sourceName || '',
        latestPrice: Number(shop.latestPrice || 0),
        imageUrl: shop.imageUrl || '',
        stats: summarizeHistory(shop.history || [], shop.latestPrice, globalLatestDate),
      };
    }
    return {
      key: card.key,
      name: card.name || '',
      modelNo: card.modelNo || '',
      imageId: card.imageId || '',
      bestShopId: card.bestShopId || '',
      latestPrice: Number(card.latestPrice || 0),
      pricesByShop,
    };
  });
}
