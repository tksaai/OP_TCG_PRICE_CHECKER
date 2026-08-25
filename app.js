// ==========================================
// ⚠️ 設定
// ==========================================
// 一覧は履歴を畳んだ軽量インデックスから描く。全履歴 (cards.json) は
// 価格グラフや資産推移で必要になった時点で読み込む。
const CARDS_INDEX_URL = 'data/cards-index.json';
const CARDS_FULL_URL = 'data/cards.json';
const CARD_DETAILS_URL = 'data/card-details.json';
const DB_CATALOG_URL = 'data/db-catalog.json';
const DB_PRICE_ALIASES_URL = 'data/db-price-aliases.json';
const DB_VARIANT_MAP_URL = 'data/db-variant-map.json';
const IMAGE_HASHES_URL = 'data/image-hashes.json';
const APP_VERSION = '2.1.0';

let chartInstance = null;
let totalAssetChartInstance = null;
let cardDataList = [];
let historyLoaded = false;
let historyLoadPromise = null;
let currentSeries = 'all'; 
let currentShop = 'best';
let renderLimit = 300;

let favorites = JSON.parse(localStorage.getItem('onepieceFavorites')) || [];
let ownedCounts = JSON.parse(localStorage.getItem('onepieceOwnedCounts')) || {};

const DETAIL_FILTER_ARRAY_KEYS = ['colors', 'costs', 'powers', 'counters', 'attributes', 'types', 'rarities', 'blocks', 'extras'];
const FILTER_LABELS = {
  colors: '色', costs: 'コスト', powers: 'パワー', counters: 'カウンター',
  attributes: '属性', types: '種別', rarities: 'レアリティ', blocks: 'ブロック', extras: 'その他'
};
let cardDetailsByNumber = new Map();
let detailFilters = createDefaultDetailFilters();
let searchTimer = null;
let dbImportPreview = null;
let dbImportResourcesPromise = null;
let dbImportModulePromise = null;

function createDefaultDetailFilters() {
  return {
    colors: [], costs: [], powers: [], counters: [], attributes: [],
    types: [], rarities: [], blocks: [], extras: [], series: '',
    minPrice: '', maxPrice: ''
  };
}

function normalizeCardNumber(value) {
  return String(value || '').normalize('NFKC').trim().toUpperCase();
}

function extractCardNumber(value) {
  const normalized = normalizeCardNumber(value);
  const match = normalized.match(/(?:^|[^A-Z0-9])((?:OP|EB|ST|PRB)\d{2}|P)-(\d{3})(?:\D|$)/);
  return match ? `${match[1]}-${match[2]}` : '';
}

function getSeriesId(card) {
  const cardNumber = normalizeCardNumber(card?.details?.cardNumber)
    || extractCardNumber(card?.modelNo)
    || extractCardNumber(card?.name);
  return cardNumber.split('-')[0] || '';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function attachCardDetails(card) {
  const detailKey = cardDetailsByNumber.has(normalizeCardNumber(card.modelNo))
    ? normalizeCardNumber(card.modelNo)
    : extractCardNumber(card.modelNo) || extractCardNumber(card.name);
  card.details = cardDetailsByNumber.get(detailKey) || {};
  card.searchIndex = OPSearchUtils.createSearchIndex(card);
  return card;
}

function normalizeCardForShops(card) {
  if (!card.pricesByShop) {
    card.pricesByShop = {
      mercard: {
        shopName: 'メルカード',
        latestPrice: Number(card.latestPrice || 0),
        imageUrl: card.imageId || '',
        history: card.history || []
      }
    };
    card.bestShopId = 'mercard';
  }
  return attachCardDetails(card);
}

function getShopData(card) {
  // 「マージなし」表示では各疑似カードが単一ショップを持つので bestShopId を使う
  // (資産集計などマージ済みリストへの参照でも最高買取として動く)
  if (currentShop !== 'best' && currentShop !== 'unmerged') return card.pricesByShop[currentShop] || null;
  return card.pricesByShop[card.bestShopId] || Object.values(card.pricesByShop).sort((a, b) => b.latestPrice - a.latestPrice)[0] || null;
}

function getActivePrice(card) {
  return Number(getShopData(card)?.latestPrice || 0);
}

function getActiveHistory(card) {
  return getShopData(card)?.history || card.history || [];
}

function getActiveImage(card) {
  return getShopData(card)?.imageUrl || card.imageId || '';
}

function getShopLastDate(shop) {
  return (shop?.history || []).at(-1)?.date || shop?.stats?.lastDate || '';
}

// 価格グラフ・資産推移で必要になったら全履歴を読み込み、一覧のカードへ合流させる
function ensureHistoryLoaded() {
  if (historyLoaded) return Promise.resolve();
  if (historyLoadPromise) return historyLoadPromise;

  historyLoadPromise = fetchJson(CARDS_FULL_URL)
    .then((fullCards) => {
      const byKey = new Map(fullCards.map((card) => [card.key, card]));
      cardDataList.forEach((card) => {
        const full = byKey.get(card.key);
        if (!full) return;
        card.history = full.history || [];
        Object.entries(card.pricesByShop || {}).forEach(([shopId, shop]) => {
          const fullShop = full.pricesByShop?.[shopId];
          shop.history = fullShop?.history || [];
          shop.sourceUrl = fullShop?.sourceUrl || shop.sourceUrl || '';
        });
      });
      historyLoaded = true;
      unmergedListCache = null;
      prepareTrendData(getRenderList());
    })
    .catch((error) => {
      historyLoadPromise = null;
      console.error('価格履歴を読み込めませんでした。', error);
      throw error;
    });

  return historyLoadPromise;
}

// 「マージなし」表示用: 統合済みカードをショップ別の出品(疑似カード)に展開する
let unmergedListCache = null;
function buildUnmergedList() {
  if (unmergedListCache) return unmergedListCache;
  unmergedListCache = [];
  for (const card of cardDataList) {
    for (const [shopId, shop] of Object.entries(card.pricesByShop || {})) {
      const pseudo = {
        ...card,
        key: `${getCardKey(card)}::${shopId}`,
        mergedKey: getCardKey(card),
        name: shop.sourceName || card.name,
        imageId: shop.imageUrl || card.imageId || '',
        bestShopId: shopId,
        latestPrice: Number(shop.latestPrice || 0),
        pricesByShop: { [shopId]: shop },
        history: shop.history || [],
        aliasKeys: [],
      };
      delete pseudo.canonicalId;
      unmergedListCache.push(pseudo);
    }
  }
  return unmergedListCache;
}

function getRenderList() {
  return currentShop === 'unmerged' ? buildUnmergedList() : cardDataList;
}

function setShop(shopId) {
  currentShop = shopId;
  renderLimit = 300;
  prepareTrendData(getRenderList());
  refreshAssetStats();
  filterAndRender();

  // ショップ別表示の前日比・週間比はそのショップの履歴から出す必要があるため、
  // 切り替えを合図に全履歴を読み込んで計算し直す
  if (!historyLoaded) {
    ensureHistoryLoaded()
      .then(() => { prepareTrendData(getRenderList()); refreshAssetStats(); filterAndRender(); })
      .catch(() => {});
  }
}

function legacyCardKey(card) {
  return card.name + "_" + card.modelNo;
}

function getCardKey(card) {
  // mergedKey は「マージなし」表示の疑似カードが持つ統合後キー。
  // お気に入り・所持数を表示モード間で共有するために統合後キーへ寄せる
  return card.mergedKey || card.canonicalId || card.key || legacyCardKey(card);
}

function getAliasKeys(card) {
  return [...new Set([legacyCardKey(card), card.key, ...(card.aliasKeys || [])].filter(Boolean))];
}

function migrateSavedCardState(cards) {
  let inventoryChanged = false;
  let favoritesChanged = false;
  const favoriteSet = new Set(favorites);

  cards.forEach(card => {
    const canonicalKey = getCardKey(card);
    const aliasKeys = getAliasKeys(card).filter(key => key !== canonicalKey);
    let migratedCount = ownedCounts[canonicalKey] || 0;

    aliasKeys.forEach(aliasKey => {
      if (ownedCounts[aliasKey]) {
        migratedCount += Number(ownedCounts[aliasKey] || 0);
        delete ownedCounts[aliasKey];
        inventoryChanged = true;
      }
      if (favoriteSet.has(aliasKey)) {
        favoriteSet.add(canonicalKey);
        favoriteSet.delete(aliasKey);
        favoritesChanged = true;
      }
    });

    if (migratedCount !== (ownedCounts[canonicalKey] || 0)) {
      ownedCounts[canonicalKey] = migratedCount;
      inventoryChanged = true;
    }
  });

  if (inventoryChanged) localStorage.setItem('onepieceOwnedCounts', JSON.stringify(ownedCounts));
  if (favoritesChanged) {
    favorites = Array.from(favoriteSet);
    localStorage.setItem('onepieceFavorites', JSON.stringify(favorites));
  }
}

function updateInventory(event, key) {
  event.stopPropagation();
  const count = parseInt(event.target.value) || 0;
  ownedCounts[key] = count < 0 ? 0 : count;
  localStorage.setItem('onepieceOwnedCounts', JSON.stringify(ownedCounts));
  refreshAssetStats();
}

function refreshAssetStats() {
  calculateTotalAssets();
  renderTotalAssetChart();
  document.getElementById('asset-breakdown').style.display = 'none';
}

function calculateTotalAssets() {
  let totalValue = 0;
  let totalCards = 0;
  cardDataList.forEach(card => {
    const key = getCardKey(card);
    const count = ownedCounts[key] || 0;
    totalCards += count;
    totalValue += (getActivePrice(card) * count);
  });
  document.getElementById('total-count').innerText = totalCards.toLocaleString() + ' 枚';
  document.getElementById('total-assets').innerText = '¥' + totalValue.toLocaleString();
}

function renderTotalAssetChart() {
  if (!historyLoaded) {
    const hasOwned = Object.values(ownedCounts).some(count => Number(count) > 0);
    if (hasOwned) {
      ensureHistoryLoaded()
        .then(() => { renderTotalAssetChart(); filterAndRender(); })
        .catch(() => {});
    }
    return;
  }

  const allDates = new Set();
  cardDataList.forEach(card => getActiveHistory(card).forEach(h => allDates.add(h.date)));
  const sortedDates = Array.from(allDates).sort((a, b) => new Date(a) - new Date(b));

  const trendData = sortedDates.map(date => {
    let dailyTotal = 0;
    cardDataList.forEach(card => {
      const count = ownedCounts[getCardKey(card)] || 0;
      if (count > 0) {
        const priceRecord = getActiveHistory(card)
          .filter(h => new Date(h.date) <= new Date(date))
          .sort((a, b) => new Date(b.date) - new Date(a.date))[0];
        if (priceRecord) dailyTotal += priceRecord.price * count;
      }
    });
    return dailyTotal;
  });

  const ctx = document.getElementById('totalAssetChart').getContext('2d');
  if (totalAssetChartInstance) totalAssetChartInstance.destroy();
  totalAssetChartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: sortedDates,
      datasets: [{
        label: '総資産', data: trendData, borderColor: '#f1c40f', backgroundColor: 'rgba(241, 196, 15, 0.1)', fill: true, tension: 0.1, pointRadius: 3
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: '#ccc', font: { size: 9 } }, grid: { display: false } },
        y: { ticks: { color: '#ccc', font: { size: 9 } }, grid: { color: 'rgba(255,255,255,0.1)' } }
      },
      onClick: (e, activeEls) => {
        if (activeEls.length > 0) {
          const dataIndex = activeEls[0].index;
          showAssetBreakdown(sortedDates[dataIndex]);
        }
      }
    }
  });
}

function showAssetBreakdown(targetDate) {
  const breakdownContainer = document.getElementById('asset-breakdown');
  let html = `<h4 class="breakdown-heading">📅 ${escapeHtml(targetDate)} 時点の内訳</h4>`;
  let totalPast = 0, totalCurrent = 0, listHtml = `<div class="breakdown-list">`;

  cardDataList.forEach(card => {
    const count = ownedCounts[getCardKey(card)] || 0;
    if (count > 0) {
      const activeHistory = getActiveHistory(card);
      const activePrice = getActivePrice(card);
      const priceRecord = activeHistory.filter(h => new Date(h.date) <= new Date(targetDate)).sort((a, b) => new Date(b.date) - new Date(a.date))[0];
      if (priceRecord) {
        totalPast += priceRecord.price * count;
        totalCurrent += activePrice * count;
        const diff = activePrice - priceRecord.price;
        listHtml += `<div class="breakdown-row">
          <div><b>${escapeHtml(card.name)}</b> x${count}</div>
          <div class="breakdown-amounts">当時 ¥${priceRecord.price.toLocaleString()} <br> 現在 ¥${activePrice.toLocaleString()} (${diff >= 0 ? '+' : ''}${diff.toLocaleString()})</div>
        </div>`;
      }
    }
  });

  const totalDiff = totalCurrent - totalPast;
  html += `<p class="breakdown-total ${totalDiff >= 0 ? 'up' : 'down'}">当時比: ${totalDiff >= 0 ? '+' : ''}¥${totalDiff.toLocaleString()}</p>`;
  breakdownContainer.innerHTML = html + listHtml + `</div>`;
  breakdownContainer.style.display = 'block';
}

function exportToCSV() {
  let csvContent = "\uFEFFカード名,型番,価格,所持枚数,小計,画像URL\n";
  let countData = 0;
  cardDataList.forEach(card => {
    const key = getCardKey(card);
    const count = ownedCounts[key] || 0;
    if (count > 0) {
      const imageId = getActiveImage(card);
      const price = getActivePrice(card);
      const imgUrl = imageId;
      csvContent += `"${card.name}","${card.modelNo}",${price},${count},${price * count},"${imgUrl}"\n`;
      countData++;
    }
  });
  if (countData === 0) return alert("所持カードがありません。");
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `onepiece_assets_${new Date().toISOString().split('T')[0]}.csv`;
  link.click();
}

function importFromCSV(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const text = e.target.result;
    const lines = text.split(/\r?\n/);
    const newCounts = {};
    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      const cols = lines[i].match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g);
      if (cols && cols.length >= 4) {
        const name = cols[0].replace(/"/g, '').trim();
        const model = cols[1].replace(/"/g, '').trim();
        const count = parseInt(cols[3].replace(/"/g, '').trim()) || 0;
        newCounts[name + "_" + model] = count;
      }
    }
    if (Object.keys(newCounts).length > 0) {
      if (confirm(`CSVから ${Object.keys(newCounts).length} 件のデータを取り込みます。現在のデータは上書きされますがよろしいですか？`)) {
        ownedCounts = newCounts;
        migrateSavedCardState(cardDataList);
        localStorage.setItem('onepieceOwnedCounts', JSON.stringify(ownedCounts));
        refreshAssetStats();
        filterAndRender();
        alert("インポートが完了しました。");
      }
    } else {
      alert("有効なデータが見つかりませんでした。CSVの形式を確認してください。");
    }
  };
  reader.readAsText(file);
  event.target.value = ''; 
}

function loadDbImportModule() {
  if (!dbImportModulePromise) {
    dbImportModulePromise = import('./scripts/lib/op-tcg-db-collection.mjs');
  }
  return dbImportModulePromise;
}

function loadDbImportResources() {
  if (!dbImportResourcesPromise) {
    dbImportResourcesPromise = Promise.all([
      fetchJson(DB_CATALOG_URL),
      fetchJson(DB_PRICE_ALIASES_URL),
      fetchJson(DB_VARIANT_MAP_URL),
      fetchJson(IMAGE_HASHES_URL).catch(() => ({}))
    ]).then(([dbCatalog, manualAliases, variantMap, imageHashes]) => ({
      dbCatalog,
      manualAliases,
      variantMap,
      imageHashes
    }));
  }
  return dbImportResourcesPromise;
}

async function importDbCollectionJson(event) {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const payload = JSON.parse(await file.text());
    const [module, resources] = await Promise.all([
      loadDbImportModule(),
      loadDbImportResources()
    ]);
    const result = module.matchCollectionPayload(payload, {
      ...resources,
      priceCards: cardDataList
    });
    dbImportPreview = { fileName: file.name, module, result };
    renderDbImportPreview();
  } catch (error) {
    console.error('DB所持JSONの読み込みに失敗しました。', error);
    alert(error?.message || 'DB所持JSONを読み込めませんでした。');
  } finally {
    event.target.value = '';
  }
}

function dbImportReasonLabel(reason) {
  return {
    'provisional-unconfirmed': '仮DB画像のため、画像または手動対応の確認待ち',
    'card-number-multiple': '同じカード番号に価格候補が複数あります',
    'variant-tags-multiple': '版種タグが一致する価格候補が複数あります',
    'image-hash-multiple': '同じ画像に価格候補が複数あります',
    'variant-unconfirmed': '版種を特定できません',
    'card-number-not-found': '価格データにカード番号がありません'
  }[reason] || reason || '判定不能';
}

function renderDbImportPreview() {
  if (!dbImportPreview) return;
  const { fileName, result } = dbImportPreview;
  const { summary } = result;
  document.getElementById('db-import-source').textContent = `${fileName} / DBアプリ ${result.payload.appVersion || '不明'} / 形式v${result.payload.version}`;
  document.getElementById('db-import-total-cards').textContent = `${summary.totalCards.toLocaleString()}枚`;
  document.getElementById('db-import-total-kinds').textContent = `${summary.totalKinds.toLocaleString()}種`;
  document.getElementById('db-import-matched').textContent = `${summary.matchedKinds.toLocaleString()}種 / ${summary.matchedCards.toLocaleString()}枚`;
  document.getElementById('db-import-ambiguous').textContent = `${summary.ambiguousKinds.toLocaleString()}種`;
  document.getElementById('db-import-unmatched-count').textContent = `${summary.unmatchedKinds.toLocaleString()}種`;

  const unresolved = result.unresolved;
  const notice = document.getElementById('db-import-notice');
  notice.textContent = unresolved.length
    ? `未解決の${unresolved.length}種類は反映されません。一致済みだけ安全に反映でき、保存JSONにはdb-price-aliases.jsonへ登録する候補キーも含まれます。`
    : 'すべてのカードを価格データへ照合できました。反映するまで所持数は変更されません。';
  document.getElementById('db-import-unresolved').innerHTML = unresolved.length
    ? unresolved.slice(0, 30).map(entry => `
        <div class="db-import-unresolved-item">
          <strong>${escapeHtml(entry.item.cardNumber)} / ${escapeHtml(entry.item.cardName || '')} ×${entry.item.count}</strong>
          <span>${escapeHtml(entry.item.variantId)}・${entry.status === 'ambiguous' ? '候補複数' : '未一致'}・${escapeHtml(dbImportReasonLabel(entry.reason))}${entry.candidates.length ? `・候補${entry.candidates.length}件` : ''}</span>
        </div>
      `).join('') + (unresolved.length > 30 ? `<div class="db-import-unresolved-item">ほか ${unresolved.length - 30}種類。保存ファイルですべて確認できます。</div>` : '')
    : '<div class="db-import-unresolved-item"><strong>未一致はありません。</strong></div>';

  document.querySelector('input[name="dbImportMode"][value="replace-matched"]').checked = true;
  document.getElementById('db-import-save-json').disabled = unresolved.length === 0;
  document.getElementById('db-import-save-csv').disabled = unresolved.length === 0;
  document.getElementById('db-import-apply').disabled = result.matches.length === 0;
  const modal = document.getElementById('db-import-modal');
  modal.style.display = 'flex';
  modal.setAttribute('aria-hidden', 'false');
}

function cancelDbCollectionImport() {
  dbImportPreview = null;
  const modal = document.getElementById('db-import-modal');
  modal.style.display = 'none';
  modal.setAttribute('aria-hidden', 'true');
}

function downloadDbImportFile(content, mimeType, extension) {
  const date = new Date().toISOString().slice(0, 10);
  const blob = new Blob([content], { type: mimeType });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `db_collection_unmatched_${date}.${extension}`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 0);
}

function saveDbImportUnmatched(format) {
  if (!dbImportPreview?.result?.unresolved?.length) return;
  const { module, result } = dbImportPreview;
  if (format === 'csv') {
    downloadDbImportFile(module.unmatchedExportToCsv(result), 'text/csv;charset=utf-8', 'csv');
    return;
  }
  const output = module.createUnmatchedExport(result);
  downloadDbImportFile(`${JSON.stringify(output, null, 2)}\n`, 'application/json;charset=utf-8', 'json');
}

function applyDbCollectionImport() {
  if (!dbImportPreview) return;
  const { module, result } = dbImportPreview;
  if (!result.matches.length) return alert('反映できる一致カードがありません。');
  const mode = document.querySelector('input[name="dbImportMode"]:checked')?.value || 'replace-matched';
  ownedCounts = module.applyCollectionMatches(ownedCounts, result.matches, mode);
  localStorage.setItem('onepieceOwnedCounts', JSON.stringify(ownedCounts));
  refreshAssetStats();
  filterAndRender();
  const appliedKinds = result.matches.length;
  const appliedCards = result.matches.reduce((sum, match) => sum + match.count, 0);
  const unresolvedKinds = result.unresolved.length;
  cancelDbCollectionImport();
  alert(`${appliedKinds}件・${appliedCards}枚を反映しました。${unresolvedKinds ? `未解決${unresolvedKinds}種類は変更していません。` : ''}`);
}

function toggleFavorite(event, key) {
  event.stopPropagation();
  const index = favorites.indexOf(key);
  if (index === -1) {
    favorites.push(key);
    event.target.classList.add('active');
  } else {
    favorites.splice(index, 1);
    event.target.classList.remove('active');
    if (document.getElementById('trendFilter').value === 'favorites') {
      event.target.closest('.card').style.display = 'none';
    }
  }
  localStorage.setItem('onepieceFavorites', JSON.stringify(favorites));
}

function fetchJson(url) {
  return fetch(url).then(response => {
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    return response.json();
  });
}

Promise.all([
  fetchJson(CARDS_INDEX_URL),
  fetchJson(CARD_DETAILS_URL).catch(error => {
    console.warn('カード属性データを取得できなかったため、価格項目のみで表示します。', error);
    return [];
  })
])
  .then(([prices, details]) => initApp(prices, details))
  .catch(error => {
    console.error(error);
    document.getElementById('loading').innerText = 'データ取得に失敗しました。';
  });

function initApp(data, details) {
  document.getElementById('loading').style.display = 'none';
  cardDetailsByNumber = new Map(
    details
      .filter(card => card?.cardNumber)
      .map(card => [normalizeCardNumber(card.cardNumber), card])
  );
  cardDataList = data.map(normalizeCardForShops);
  migrateSavedCardState(cardDataList);
  prepareTrendData(cardDataList);
  populateDetailFilters(cardDataList);
  setupSearchAndFilterEvents();
  refreshAssetStats();
  filterAndRender();
}

function prepareTrendData(data) {
  if (!historyLoaded) {
    // cards-index.json が持つ事前計算値をそのまま使う
    data.forEach(c => {
      const stats = getShopData(c)?.stats || {};
      c.activePrice = getActivePrice(c);
      c.trendDiff = stats.trendDiff || 0;
      c.trendPercent = stats.trendPercent || 0;
      c.weeklyDiff = stats.weeklyDiff || 0;
      c.weeklyPercent = stats.weeklyPercent || 0;
      c.minPrice = stats.minPrice || 0;
      c.maxPrice = stats.maxPrice || 0;
    });
    return;
  }

  let latestStr = '1970/01/01';
  
  data.forEach(c => {
    const history = getActiveHistory(c);
    if (history.length) {
      const d = history[history.length-1].date;
      if (d > latestStr) latestStr = d;
    }
  });
  const globalLatestDate = new Date(latestStr);

  data.forEach(c => {
    c.trendPercent = 0; c.trendDiff = 0; c.weeklyDiff = 0; c.weeklyPercent = 0;
    const history = getActiveHistory(c);
    const p = history.map(h => h.price);
    c.activePrice = getActivePrice(c);
    c.minPrice = p.length ? Math.min(...p) : 0;
    c.maxPrice = p.length ? Math.max(...p) : 0;
    
    if (history.length > 0) {
      const last = history[history.length-1];
      if (last.date === latestStr && history.length >= 2) {
        const prev = history[history.length-2];
        c.trendDiff = last.price - prev.price;
        if(prev.price > 0) c.trendPercent = (c.trendDiff / prev.price) * 100;
      }
      
      const targetDate = new Date(globalLatestDate);
      targetDate.setDate(globalLatestDate.getDate() - 7);
      const hasWeekly = history.some(h => new Date(h.date) > targetDate);
      
      if (hasWeekly && history.length >= 2) {
        let weekAgo = history.slice().reverse().find(h => new Date(h.date) <= targetDate);
        if (!weekAgo) weekAgo = history[0];
        c.weeklyDiff = c.activePrice - weekAgo.price;
        if(weekAgo.price > 0) c.weeklyPercent = (c.weeklyDiff / weekAgo.price) * 100;
      }
    }
  });
}

function sortNumericValues(values) {
  return [...values].map(String).sort((a, b) => {
    if (a === '-') return -1;
    if (b === '-') return 1;
    return Number(a) - Number(b);
  });
}

function createFilterGroup(key, label, options, wide = false) {
  if (!options.length) return '';
  const optionHtml = options.map(option => `
    <label class="filter-option">
      <input type="checkbox" name="filter-${escapeHtml(key)}" value="${escapeHtml(option)}">
      <span>${escapeHtml(option)}</span>
    </label>
  `).join('');
  return `
    <fieldset class="filter-group">
      <legend>${escapeHtml(label)}（項目内 OR）</legend>
      <div class="filter-grid${wide ? ' wide' : ''}">${optionHtml}</div>
    </fieldset>
  `;
}

function populateDetailFilters(cards) {
  const values = Object.fromEntries(
    ['colors', 'costs', 'powers', 'counters', 'attributes', 'types', 'rarities', 'blocks'].map(key => [key, new Set()])
  );
  const series = new Map();

  cards.forEach(card => {
    const details = card.details || {};
    (Array.isArray(details.color) ? details.color : []).forEach(value => values.colors.add(String(value)));
    if (details.costLifeType === 'コスト' && details.costLifeValue !== undefined && details.costLifeValue !== null) {
      values.costs.add(String(details.costLifeValue === '-' ? 0 : details.costLifeValue));
    }
    if (details.power !== undefined && details.power !== null && details.power !== '') {
      values.powers.add(String(details.power === '-' ? 0 : details.power));
    }
    if (details.counter !== undefined && details.counter !== null && details.counter !== '') {
      values.counters.add(String(details.counter));
    }
    if (details.attribute && details.attribute !== '-') {
      String(details.attribute).split('/').filter(Boolean).forEach(value => values.attributes.add(value));
    }
    if (details.cardType && details.cardType !== 'ドン!!') values.types.add(String(details.cardType));
    if (details.rarity) values.rarities.add(String(details.rarity));
    if (details.block !== undefined && details.block !== null && details.block !== '') values.blocks.add(String(details.block));

    const seriesId = getSeriesId(card);
    if (seriesId && !series.has(seriesId)) {
      series.set(seriesId, details.seriesTitle ? `${seriesId} - ${details.seriesTitle}` : seriesId);
    }
  });

  const colorOrder = ['赤', '青', '緑', '紫', '黒', '黄'];
  const typeOrder = ['LEADER', 'CHARACTER', 'EVENT', 'STAGE'];
  const rarityOrder = ['L', 'SEC', 'SP', 'SR', 'R', 'UC', 'C', 'P'];
  const ordered = (set, preferred) => [...set].sort((a, b) => {
    const aIndex = preferred.indexOf(a);
    const bIndex = preferred.indexOf(b);
    if (aIndex === -1 && bIndex === -1) return a.localeCompare(b, 'ja', { numeric: true });
    if (aIndex === -1) return 1;
    if (bIndex === -1) return -1;
    return aIndex - bIndex;
  });
  const seriesOptions = [...series.entries()]
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
    .map(([id, label]) => `<option value="${escapeHtml(id)}">${escapeHtml(label)}</option>`)
    .join('');

  document.getElementById('filter-options').innerHTML = `
    <fieldset class="filter-group">
      <legend>現在価格</legend>
      <div class="price-filter-row">
        <input type="number" id="filterMinPrice" min="0" step="100" inputmode="numeric" placeholder="最低価格">
        <span>〜</span>
        <input type="number" id="filterMaxPrice" min="0" step="100" inputmode="numeric" placeholder="最高価格">
      </div>
    </fieldset>
    ${createFilterGroup('colors', '色', ordered(values.colors, colorOrder))}
    ${createFilterGroup('costs', 'コスト', sortNumericValues(values.costs))}
    ${createFilterGroup('powers', 'パワー', sortNumericValues(values.powers))}
    ${createFilterGroup('counters', 'カウンター', sortNumericValues(values.counters))}
    ${createFilterGroup('attributes', '属性', [...values.attributes].sort(), true)}
    ${createFilterGroup('types', '種別', ordered(values.types, typeOrder), true)}
    ${createFilterGroup('rarities', 'レアリティ', ordered(values.rarities, rarityOrder))}
    ${createFilterGroup('blocks', 'ブロック', sortNumericValues(values.blocks))}
    ${createFilterGroup('extras', 'その他', ['ブロッカー', 'トリガー', 'バニラ', 'パラレル・別イラスト'], true)}
    <fieldset class="filter-group">
      <legend>シリーズ</legend>
      <select id="filterSeries" class="filter-select">
        <option value="">すべて</option>
        ${seriesOptions}
      </select>
    </fieldset>
  `;
  syncDetailFilterControls();
}

function syncDetailFilterControls() {
  DETAIL_FILTER_ARRAY_KEYS.forEach(key => {
    document.querySelectorAll(`input[name="filter-${key}"]`).forEach(input => {
      input.checked = detailFilters[key].includes(input.value);
    });
  });
  const series = document.getElementById('filterSeries');
  const minPrice = document.getElementById('filterMinPrice');
  const maxPrice = document.getElementById('filterMaxPrice');
  if (series) series.value = detailFilters.series;
  if (minPrice) minPrice.value = detailFilters.minPrice;
  if (maxPrice) maxPrice.value = detailFilters.maxPrice;
}

function readDetailFiltersFromControls() {
  const next = createDefaultDetailFilters();
  DETAIL_FILTER_ARRAY_KEYS.forEach(key => {
    next[key] = [...document.querySelectorAll(`input[name="filter-${key}"]:checked`)].map(input => input.value);
  });
  next.series = document.getElementById('filterSeries')?.value || '';
  next.minPrice = document.getElementById('filterMinPrice')?.value || '';
  next.maxPrice = document.getElementById('filterMaxPrice')?.value || '';

  if (next.minPrice !== '' && next.maxPrice !== '' && Number(next.minPrice) > Number(next.maxPrice)) {
    [next.minPrice, next.maxPrice] = [next.maxPrice, next.minPrice];
  }
  return next;
}

function countActiveDetailFilters() {
  return DETAIL_FILTER_ARRAY_KEYS.reduce((count, key) => count + detailFilters[key].length, 0)
    + (detailFilters.series ? 1 : 0)
    + (detailFilters.minPrice !== '' ? 1 : 0)
    + (detailFilters.maxPrice !== '' ? 1 : 0);
}

function updateFilterIndicators() {
  const count = countActiveDetailFilters();
  const badge = document.getElementById('filterCount');
  badge.textContent = count;
  badge.style.display = count ? 'inline-flex' : 'none';

  const chips = [];
  DETAIL_FILTER_ARRAY_KEYS.forEach(key => {
    if (detailFilters[key].length) chips.push(`${FILTER_LABELS[key]}: ${detailFilters[key].join('・')}`);
  });
  if (detailFilters.series) chips.push(`シリーズ: ${detailFilters.series}`);
  if (detailFilters.minPrice !== '' || detailFilters.maxPrice !== '') {
    const min = detailFilters.minPrice === '' ? '0' : Number(detailFilters.minPrice).toLocaleString();
    const max = detailFilters.maxPrice === '' ? '上限なし' : `¥${Number(detailFilters.maxPrice).toLocaleString()}`;
    chips.push(`価格: ¥${min}〜${max}`);
  }
  document.getElementById('active-filter-chips').innerHTML = chips
    .map(chip => `<span class="filter-chip">${escapeHtml(chip)}</span>`)
    .join(' ');
}

function openDetailFilterModal() {
  syncDetailFilterControls();
  document.getElementById('filter-modal').style.display = 'flex';
  document.body.style.overflow = 'hidden';
  document.getElementById('closeFilterBtn').focus();
}

function closeDetailFilterModal() {
  document.getElementById('filter-modal').style.display = 'none';
  document.body.style.overflow = '';
  document.getElementById('openFilterBtn').focus();
}

function queueSearchRender() {
  const input = document.getElementById('searchInput');
  document.getElementById('clearSearchBtn').style.display = input.value ? 'block' : 'none';
  renderLimit = 300;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(filterAndRender, 160);
}

function setupSearchAndFilterEvents() {
  const searchInput = document.getElementById('searchInput');
  const clearSearchBtn = document.getElementById('clearSearchBtn');
  const filterModal = document.getElementById('filter-modal');

  searchInput.addEventListener('input', queueSearchRender);
  clearSearchBtn.addEventListener('click', () => {
    searchInput.value = '';
    clearSearchBtn.style.display = 'none';
    renderLimit = 300;
    filterAndRender();
    searchInput.focus();
  });
  ['searchMode', 'fuzzySearch'].forEach(id => {
    document.getElementById(id).addEventListener('change', () => {
      renderLimit = 300;
      filterAndRender();
    });
  });
  document.getElementById('openFilterBtn').addEventListener('click', openDetailFilterModal);
  document.getElementById('closeFilterBtn').addEventListener('click', closeDetailFilterModal);
  document.getElementById('applyFilterBtn').addEventListener('click', () => {
    detailFilters = readDetailFiltersFromControls();
    renderLimit = 300;
    closeDetailFilterModal();
    filterAndRender();
  });
  document.getElementById('resetFilterBtn').addEventListener('click', () => {
    detailFilters = createDefaultDetailFilters();
    syncDetailFilterControls();
    renderLimit = 300;
    filterAndRender();
  });
  filterModal.addEventListener('click', event => {
    if (event.target === filterModal) closeDetailFilterModal();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && filterModal.style.display === 'flex') closeDetailFilterModal();
  });
}

function isParallelOrAlternateArt(card) {
  return /パラレル|コミパラ|スーパー\s*パラレル|スペシャル|別イラスト|絵違い|漫画背景|\bSP\b/i.test(card.name || '');
}

function matchesDetailFilters(card, activePrice) {
  const details = card.details || {};
  const matchesAny = (selected, actual) => selected.length === 0 || selected.some(value => actual.includes(value));

  if (!matchesAny(detailFilters.colors, Array.isArray(details.color) ? details.color.map(String) : [])) return false;
  if (detailFilters.costs.length) {
    if (details.costLifeType !== 'コスト') return false;
    const value = String(details.costLifeValue === '-' || details.costLifeValue === undefined ? 0 : details.costLifeValue);
    if (!detailFilters.costs.includes(value)) return false;
  }
  if (detailFilters.powers.length) {
    const value = String(details.power === '-' || details.power === undefined ? 0 : details.power);
    if (!detailFilters.powers.includes(value)) return false;
  }
  if (detailFilters.counters.length && !detailFilters.counters.includes(String(details.counter ?? '-'))) return false;
  const attributes = details.attribute && details.attribute !== '-' ? String(details.attribute).split('/') : [];
  if (!matchesAny(detailFilters.attributes, attributes)) return false;
  if (detailFilters.types.length && !detailFilters.types.includes(String(details.cardType || ''))) return false;
  if (detailFilters.rarities.length && !detailFilters.rarities.includes(String(details.rarity || ''))) return false;
  if (detailFilters.blocks.length && !detailFilters.blocks.includes(String(details.block ?? ''))) return false;
  if (detailFilters.series && getSeriesId(card) !== detailFilters.series) return false;
  if (detailFilters.minPrice !== '' && activePrice < Number(detailFilters.minPrice)) return false;
  if (detailFilters.maxPrice !== '' && activePrice > Number(detailFilters.maxPrice)) return false;

  for (const extra of detailFilters.extras) {
    if (extra === 'ブロッカー' && !String(details.effectText || '').includes('【ブロッカー】')) return false;
    if (extra === 'トリガー' && (!details.trigger || details.trigger === '-')) return false;
    if (extra === 'バニラ' && details.effectText && details.effectText !== '-') return false;
    if (extra === 'パラレル・別イラスト' && !isParallelOrAlternateArt(card)) return false;
  }
  return true;
}

function setSeries(series, btn) {
  currentSeries = series;
  renderLimit = 300;
  document.querySelectorAll('.series-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  filterAndRender();
}

function loadMoreCards() {
  renderLimit += 300;
  filterAndRender();
}

function filterAndRender() {
  const grid = document.getElementById('grid'), noData = document.getElementById('no-data-msg'), loadMore = document.getElementById('load-more');
  grid.innerHTML = '';
  const parsedSearch = OPSearchUtils.parseSearchQuery(document.getElementById('searchInput').value);
  const searchMode = document.getElementById('searchMode').value;
  const fuzzySearch = document.getElementById('fuzzySearch').checked;
  const filter = document.getElementById('trendFilter').value;
  const sort = document.getElementById('sortOrder').value;

  let filtered = getRenderList().filter(c => {
    const key = getCardKey(c);
    const activePrice = getActivePrice(c);
    const matchText = OPSearchUtils.matchesSearch(
      c.searchIndex || OPSearchUtils.createSearchIndex(c),
      parsedSearch,
      searchMode,
      fuzzySearch
    );
    let matchFilter = true;
    
    if (filter === 'favorites') matchFilter = favorites.includes(key);
    else if (filter === 'owned') matchFilter = (ownedCounts[key] || 0) > 0;
    else if (filter === 'allTimeHigh') matchFilter = activePrice > 0 && activePrice >= c.maxPrice;
    else if (filter === 'surge') matchFilter = c.trendPercent >= 5;
    else if (filter === 'crash') matchFilter = c.trendPercent <= -5;
    else if (filter === 'high') matchFilter = activePrice >= 100000;
    else if (filter === 'dailyUp') matchFilter = c.trendDiff > 0;
    else if (filter === 'dailyDown') matchFilter = c.trendDiff < 0;
    else if (filter === 'weeklyUp') matchFilter = c.weeklyDiff > 0;
    else if (filter === 'weeklyDown') matchFilter = c.weeklyDiff < 0;
    
    const matchesSeriesButton = currentSeries === 'all' || getSeriesId(c).startsWith(currentSeries.replace('-', ''));
    return activePrice > 0 && matchText && matchFilter && matchesSeriesButton && matchesDetailFilters(c, activePrice);
  });

  filtered.sort((a, b) => {
    if (sort === 'priceDesc') return getActivePrice(b) - getActivePrice(a);
    if (sort === 'priceAsc') return getActivePrice(a) - getActivePrice(b);
    if (sort === 'trendDesc') return b.trendDiff - a.trendDiff;
    if (sort === 'trendAsc') return a.trendDiff - b.trendDiff;
    if (sort === 'weeklyDesc') return b.weeklyDiff - a.weeklyDiff;
    if (sort === 'weeklyAsc') return a.weeklyDiff - b.weeklyDiff;
    return a.modelNo.localeCompare(b.modelNo);
  });

  updateFilterIndicators();
  const visibleCount = Math.min(filtered.length, renderLimit);
  document.getElementById('result-count').textContent = filtered.length
    ? `${filtered.length.toLocaleString()}件中 ${visibleCount.toLocaleString()}件表示`
    : '0件';

  if (!filtered.length) { noData.style.display = 'block'; loadMore.style.display = 'none'; return; }
  noData.style.display = 'none';
  loadMore.style.display = filtered.length > renderLimit ? 'block' : 'none';

  filtered.slice(0, renderLimit).forEach(c => {
    const key = getCardKey(c);
    const shopData = getShopData(c);
    const activePrice = getActivePrice(c);
    // 3日以上更新が止まっているショップ価格は「いつ時点か」を注記する
    // (買取停止後の最終価格が現在の価格に見えてしまうのを防ぐ)
    const shopDates = Object.values(c.pricesByShop || {})
      .map(shop => getShopLastDate(shop))
      .filter(Boolean);
    const newestDate = shopDates.sort().at(-1) || '';
    const shopCompareHtml = Object.entries(c.pricesByShop || {})
      .sort((a, b) => b[1].latestPrice - a[1].latestPrice)
      .map(([, shop]) => {
        const lastDate = getShopLastDate(shop);
        const staleDays = lastDate && newestDate
          ? (new Date(newestDate) - new Date(lastDate)) / 86400000 : 0;
        const staleNote = staleDays >= 3
          ? ` <small class="stale-note">(${escapeHtml(lastDate.slice(5))}時点)</small>` : '';
        return `<div><span>${escapeHtml(shop.shopName)}${staleNote}</span><b>¥${Number(shop.latestPrice || 0).toLocaleString()}</b></div>`;
      })
      .join('');
    
    // 1. 大枠のdivを作成
    const div = document.createElement('div');
    div.className = 'card';
    div.onclick = () => openModal(c);
    
    // 2. 星ボタンを作成（DOMとして独立させる）
    const star = document.createElement('div');
    star.className = 'star-btn ' + (favorites.includes(key) ? 'active' : '');
    star.textContent = '★';
    star.onclick = (e) => toggleFavorite(e, key);

    // 3. 画像を作成（★ここで no-referrer を設定）
    const img = document.createElement('img');
    img.setAttribute('loading', 'lazy');
    img.setAttribute('referrerpolicy', 'no-referrer');
    const imageId = getActiveImage(c);
    // 画像 URL はショップのものをそのまま使う (未設定なら読み込ませない)
    if (imageId) img.src = imageId;
    img.alt = c.name || c.modelNo || '';
    
    // 4. 情報部分のdivを作成（innerHTML += によるバグを防ぐ）
    const infoDiv = document.createElement('div');
    infoDiv.innerHTML = `
      <div class="card-name">${escapeHtml(c.name)}</div>
      <div class="card-model">${escapeHtml(c.modelNo)}</div>
      <div class="shop-badge">${currentShop === 'best' ? '最高買取: ' : ''}${escapeHtml(shopData?.shopName || '')}</div>
      <div class="price-main">¥${activePrice.toLocaleString()}</div>
      <div class="shop-compare">${shopCompareHtml}</div>
      
      <div class="trend-container">
        <div class="trend ${c.trendDiff>0?'up':c.trendDiff<0?'down':'flat'}">
          <span class="label">前日比:</span> 
          <span>${c.trendDiff>0?'▲ +¥'+c.trendDiff.toLocaleString():c.trendDiff<0?'▼ ¥'+Math.abs(c.trendDiff).toLocaleString():'▶ 変動なし'}</span>
        </div>
        <div class="trend ${c.weeklyDiff>0?'up':c.weeklyDiff<0?'down':'flat'}">
          <span class="label">週間比:</span> 
          <span>${c.weeklyDiff>0?'▲ +¥'+c.weeklyDiff.toLocaleString():c.weeklyDiff<0?'▼ ¥'+Math.abs(c.weeklyDiff).toLocaleString():'▶ 変動なし'}</span>
        </div>
      </div>
      
      <div class="price-range">
        <div>最安 <span class="price-min">¥${c.minPrice.toLocaleString()}</span></div>
        <div>最高 <span class="price-max">¥${c.maxPrice.toLocaleString()}</span></div>
      </div>
      
      <div class="inventory-control">
        <label class="inventory-label">枚数:</label>
        <input type="number" class="inventory-input" value="${Number(ownedCounts[key] || 0)}" min="0">
      </div>
    `;

    // 所持枚数の入力は data-key + addEventListener で結ぶ
    // (HTML属性に文字列を埋め込むと、カード名や型番由来の引用符で壊れるため)
    const inventoryInput = infoDiv.querySelector('.inventory-input');
    inventoryInput.dataset.key = key;
    inventoryInput.addEventListener('click', (event) => event.stopPropagation());
    inventoryInput.addEventListener('change', (event) => updateInventory(event, key));
    
    // 5. 全てを安全に合体させる
    div.appendChild(star); 
    div.appendChild(img); 
    div.appendChild(infoDiv);
    
    grid.appendChild(div);
  });
}

async function openModal(c) {
  const shopData = getShopData(c);
  document.getElementById('modal-title').textContent = `${c.name} / ${shopData?.shopName || ''}`;
  document.getElementById('modal').style.display = 'flex';

  try {
    await ensureHistoryLoaded();
  } catch {
    // 履歴が取れなくてもモーダルは開いたままにする (価格だけは見えている)
  }

  const history = getActiveHistory(c);
  const ctx = document.getElementById('priceChart').getContext('2d');
  if(chartInstance) chartInstance.destroy();
  chartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: history.map(h => h.date),
      datasets: [{ label: '買取価格 (円)', data: history.map(h => h.price), borderColor: '#007bff', backgroundColor: 'rgba(0, 123, 255, 0.1)', fill: true, tension: 0.1 }]
    }
  });
}
function closeModal() { document.getElementById('modal').style.display = 'none'; }

// === 静的UIのイベント結線 ===================================================
// HTML から onclick / onchange を外し、data-action で結ぶ。
// これにより CSP の script-src を 'self' だけに絞れる。
function handleStaticAction(action, element, event) {
  switch (action) {
    case 'export-csv': exportToCSV(); break;
    case 'open-csv-input': document.getElementById('csvInput').click(); break;
    case 'import-csv': importFromCSV(event); break;
    case 'open-db-input': document.getElementById('dbCollectionInput').click(); break;
    case 'import-db-json': importDbCollectionJson(event); break;
    case 'set-shop': setShop(element.value); break;
    case 'rerender': filterAndRender(); break;
    case 'set-series': setSeries(element.dataset.series, element); break;
    case 'load-more': loadMoreCards(); break;
    case 'close-modal': closeModal(); break;
    case 'cancel-db-import': cancelDbCollectionImport(); break;
    case 'save-db-unmatched': saveDbImportUnmatched(element.dataset.format); break;
    case 'apply-db-import': applyDbCollectionImport(); break;
    default: console.warn('未定義の data-action:', action);
  }
}

function bindStaticActions() {
  document.querySelectorAll('[data-action]').forEach((element) => {
    const action = element.dataset.action;
    const usesChange = element.tagName === 'SELECT' || element.type === 'file';
    element.addEventListener(usesChange ? 'change' : 'click', (event) => {
      handleStaticAction(action, element, event);
    });
    if (element.getAttribute('role') === 'button') {
      element.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          handleStaticAction(action, element, event);
        }
      });
    }
  });
}

bindStaticActions();
