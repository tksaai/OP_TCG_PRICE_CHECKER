// 価格取得・一覧表示から一時的に除外するショップを一元管理する。
// pricesByShop の過去データは削除せず、再有効化できるように保持する。
const DISABLED_SHOP_IDS = new Set(['cardrush']);

export function unavailableShopIdsFromReport(report) {
  const unavailable = new Set();
  for (const shop of report?.shops || []) {
    const fetched = Number(shop?.fetched || 0);
    if (shop?.status === 'paused' || (shop?.healthy === false && fetched === 0)) {
      unavailable.add(String(shop.id || ''));
    }
  }
  return unavailable;
}

export function isShopEnabled(shopId, unavailableShopIds = new Set()) {
  const id = String(shopId || '');
  return !DISABLED_SHOP_IDS.has(id) && !unavailableShopIds.has(id);
}

export function enabledShopEntries(card, unavailableShopIds = new Set()) {
  return Object.entries(card?.pricesByShop || {})
    .filter(([shopId]) => isShopEnabled(shopId, unavailableShopIds));
}

export function bestEnabledShop(card, unavailableShopIds = new Set()) {
  return enabledShopEntries(card, unavailableShopIds)
    .filter(([, shop]) => Number(shop?.latestPrice || 0) > 0)
    .sort((a, b) => Number(b[1].latestPrice || 0) - Number(a[1].latestPrice || 0))[0] || null;
}

export function hasStoredShopPrice(card) {
  return Object.values(card?.pricesByShop || {})
    .some((shop) => Number(shop?.latestPrice || 0) > 0);
}
