// 価格取得・一覧表示から一時的に除外するショップを一元管理する。
// pricesByShop の過去データは削除せず、再有効化できるように保持する。
const DISABLED_SHOP_IDS = new Set(['cardrush']);

export function isShopEnabled(shopId) {
  return !DISABLED_SHOP_IDS.has(String(shopId || ''));
}

export function enabledShopEntries(card) {
  return Object.entries(card?.pricesByShop || {})
    .filter(([shopId]) => isShopEnabled(shopId));
}

export function bestEnabledShop(card) {
  return enabledShopEntries(card)
    .filter(([, shop]) => Number(shop?.latestPrice || 0) > 0)
    .sort((a, b) => Number(b[1].latestPrice || 0) - Number(a[1].latestPrice || 0))[0] || null;
}

export function hasStoredShopPrice(card) {
  return Object.values(card?.pricesByShop || {})
    .some((shop) => Number(shop?.latestPrice || 0) > 0);
}
