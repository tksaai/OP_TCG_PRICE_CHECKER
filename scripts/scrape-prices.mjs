import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { cardKeyFor } from './lib/card-identity.mjs';
import { rekeyCards } from './lib/card-store.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const DATA_PATH = path.join(ROOT, 'data', 'cards.json');

const SHOPS = [
  {
    id: 'mercard',
    name: 'メルカード',
    url: 'https://akihabara-cardshop.com/onepice-kaitori/',
    type: 'mercardHtml',
  },
  {
    id: 'cardrush',
    name: 'カードラッシュ',
    url: 'https://cardrush.media/onepiece/buying_prices?displayMode=%E3%83%AA%E3%82%B9%E3%83%88&limit=5000&name=&rarity=&model_number=&amount=&page=1&sort%5Bkey%5D=amount&sort%5Border%5D=desc&associations%5B%5D=ocha_product&to_json_option%5Bexcept%5D%5B%5D=original_image_source&to_json_option%5Bexcept%5D%5B%5D=created_at&to_json_option%5Binclude%5D%5Bocha_product%5D%5Bonly%5D%5B%5D=id&to_json_option%5Binclude%5D%5Bocha_product%5D%5Bmethods%5D%5B%5D=image_source&display_category%5B%5D=%E6%9C%80%E6%96%B0%E5%BC%BE&display_category%5B%5D=%E9%80%9A%E5%B8%B8%E5%BC%BE',
    type: 'cardrushNextData',
    // 2026-07-15 以降、GitHub Actions からのアクセスに 403 が返るようになった
    // (同じ User-Agent でも手元の回線からは 200 が返るため、データセンター IP 側の
    //  拒否とみられる)。回避は行わず取得を止めている。
    // 復旧を確認できたら enabled を true に戻す。過去の価格履歴はそのまま残る。
    enabled: false,
  },
  {
    id: 'torecard',
    name: 'トレカード秋葉原',
    url: 'https://www.torecard.com/purchase/onepiece/list/',
    type: 'torecardHtml',
  },
];

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function todayJst() {
  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const byType = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${byType.year}/${byType.month}/${byType.day}`;
}

// 制御文字を空白に落とす (正規表現のエスケープを避けてコードポイントで判定する)
function stripControlChars(value) {
  let result = '';
  for (const char of String(value)) {
    const code = char.codePointAt(0);
    result += code < 32 || code === 127 ? ' ' : char;
  }
  return result;
}

// 取り込んだ文字列はそのまま画面に出るので、ここでタグと制御文字を落としておく
// (フロント側でもエスケープするが、保存するデータ自体を汚さない)
function sanitizeText(value) {
  return stripControlChars(String(value ?? ''))
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

const stripTags = sanitizeText;

// 取得件数がここまで落ちたら、ページ構造が変わった可能性が高い
const LINE_END = '\n';
const SHOP_DROP_RATIO = 0.5;
const SHOP_MIN_BASELINE = 20;
const REPORT_PATH = 'data/scrape-report.json';

// 同一性キーは「型番 + 版種タグ」(card-identity.mjs)。カード名の表記揺れは
// キーに影響せず、ショップ間で同じカードが自動的に同一キーへ集約される。

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0 (compatible; OP_TCG_PRICE_CHECKER/1.0)',
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return response.text();
}

async function scrapeMercard(shop) {
  const html = await fetchText(shop.url);
  const itemRegex = /<div class="td td1">\s*<img[^>]+src="([^"]+)"[^>]*>[\s\S]*?<div class="td td2">([\s\S]*?)<\/div>[\s\S]*?<div class="td td3">([\s\S]*?)<\/div>[\s\S]*?<span class="price">([\d,]+)<\/span>/g;
  const cards = [];
  let match;

  while ((match = itemRegex.exec(html)) !== null) {
    const name = stripTags(match[2]);
    const modelNo = stripTags(match[3])
      .replace(/^型(?:番)?[:：\s]*/u, '')
      .replace(/[‐-‒–—―]|&#8211;/g, '-')
      .trim();
    const imageUrl = match[1].startsWith('/') ? new URL(match[1], shop.url).href : match[1];
    const price = Number(match[4].replace(/,/g, ''));

    if (name && modelNo && price > 0) {
      cards.push({ name, modelNo, imageUrl, price });
    }
  }

  return cards;
}

function extractTorecardModel(name) {
  const matches = String(name || '').match(/(?:OP|ST|EB|PRB)\d{2}-\d{3}|P-\d{3}/gi);
  return matches ? matches[matches.length - 1].toUpperCase() : '';
}

async function scrapeTorecard(shop) {
  const html = await fetchText(shop.url);
  const itemRegex = /<li class="list-group-item[\s\S]*?<img[^>]+class="card-list-img"[^>]+alt="([^"]*)"[^>]+src="([^"]+)"[\s\S]*?<div class="card-list-price[^"]*">([\d,]+)円<\/div><div class="card-list-name">([\s\S]*?)<\/div>/g;
  const cards = [];
  let match;

  while ((match = itemRegex.exec(html)) !== null) {
    const name = stripTags(match[4] || match[1]);
    const imageUrl = match[2].startsWith('/') ? new URL(match[2], shop.url).href : match[2];
    const price = Number(match[3].replace(/,/g, ''));
    const modelNo = extractTorecardModel(name);

    if (name && modelNo && price > 0) {
      cards.push({ name, modelNo, imageUrl, price });
    }
  }

  return cards;
}

async function scrapeCardrush(shop) {
  const html = await fetchText(shop.url);
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!match) {
    throw new Error('Cardrush __NEXT_DATA__ was not found');
  }

  const data = JSON.parse(match[1]);
  const buyingPrices = data?.props?.pageProps?.buyingPrices || [];

  return buyingPrices
    .map((item) => {
      const extra = item.extra_difference ? `(${sanitizeText(item.extra_difference)})` : '';
      return {
        name: `${sanitizeText(item.name)}${extra}`,
        modelNo: sanitizeText(item.model_number),
        imageUrl: item.ocha_product?.image_source || '',
        price: Number(item.amount || 0),
        rarity: sanitizeText(item.rarity),
      };
    })
    .filter((card) => card.name && card.modelNo && card.price > 0);
}

// 既存データを新キーで Map 化する。旧キー形式のカードもここで自動的に
// 再キー化され、同一カードはマージされる(初回実行時のマイグレーションを兼ねる)。
const normalizePrevious = rekeyCards;

function upsertHistory(history, date, price) {
  const next = Array.isArray(history) ? [...history] : [];
  const last = next[next.length - 1];
  if (last?.date === date) {
    last.price = price;
  } else if (!last || Number(last.price) !== price) {
    next.push({ date, price });
  }
  return next;
}

function recomputeBest(card, date) {
  const entries = Object.entries(card.pricesByShop || {}).filter(([, value]) => value.latestPrice > 0);
  const best = entries.sort((a, b) => b[1].latestPrice - a[1].latestPrice)[0];
  const bestPrice = best ? best[1].latestPrice : 0;

  card.bestShopId = best ? best[0] : '';
  card.latestPrice = bestPrice;
  card.imageId = best?.[1]?.imageUrl || card.imageId || '';
  card.history = upsertHistory(card.history || [], date, bestPrice);
  return card;
}

async function readPrevious() {
  try {
    return JSON.parse(await readFile(DATA_PATH, 'utf8'));
  } catch {
    return [];
  }
}

// 前回データから「そのショップの価格を持っていたカード数」を数える
function countCardsByShop(cards) {
  const counts = new Map();
  for (const card of cards.values()) {
    for (const shopId of Object.keys(card.pricesByShop || {})) {
      counts.set(shopId, (counts.get(shopId) || 0) + 1);
    }
  }
  return counts;
}

async function main() {
  const date = todayJst();
  const cards = normalizePrevious(await readPrevious());
  const previousCounts = countCardsByShop(cards);
  const report = { date, shops: [] };
  let successfulShops = 0;
  let scrapedCardCount = 0;

  for (const shop of SHOPS) {
    if (shop.enabled === false) {
      console.log(`Skipping ${shop.name} (取得停止中)`);
      report.shops.push({
        id: shop.id, name: shop.name, fetched: 0,
        previous: previousCounts.get(shop.id) || 0, healthy: true, skipped: true, error: null,
      });
      continue;
    }

    console.log(`Fetching ${shop.name}`);
    let scraped = [];

    try {
      scraped =
        shop.type === 'cardrushNextData'
          ? await scrapeCardrush(shop)
          : shop.type === 'torecardHtml'
            ? await scrapeTorecard(shop)
            : await scrapeMercard(shop);
    } catch (error) {
      console.error(`Failed to fetch ${shop.id}: ${error.message}`);
      report.shops.push({
        id: shop.id, name: shop.name, fetched: 0,
        previous: previousCounts.get(shop.id) || 0, healthy: false, error: error.message,
      });
      await wait(1500);
      continue;
    }

    successfulShops += 1;
    scrapedCardCount += scraped.length;
    console.log(`Fetched ${scraped.length} cards from ${shop.id}`);

    // 1 店だけ壊れても全体は成功してしまうので、前回件数と比べて記録に残す
    const previous = previousCounts.get(shop.id) || 0;
    const healthy = !(previous >= SHOP_MIN_BASELINE && scraped.length < previous * SHOP_DROP_RATIO);
    if (!healthy) {
      console.error(`::warning::${shop.name} の取得件数が前回の半分未満です (${scraped.length} < ${previous})`);
    }
    report.shops.push({ id: shop.id, name: shop.name, fetched: scraped.length, previous, healthy, error: null });

    for (const item of scraped) {
      const key = cardKeyFor(item.name, item.modelNo);
      const current = cards.get(key) || {
        key,
        name: item.name,
        modelNo: item.modelNo,
        imageId: item.imageUrl,
        history: [],
        pricesByShop: {},
      };

      const previousShop = current.pricesByShop[shop.id] || {};
      // 表示名は安定性を優先して既存値を保持(ショップ別の生の名前は sourceName へ)
      current.name = current.name || item.name;
      current.modelNo = current.modelNo || item.modelNo;
      current.imageId = current.imageId || item.imageUrl;
      current.pricesByShop[shop.id] = {
        shopName: shop.name,
        latestPrice: item.price,
        imageUrl: item.imageUrl || previousShop.imageUrl || '',
        sourceUrl: shop.url,
        sourceName: item.name,
        history: upsertHistory(previousShop.history || [], date, item.price),
      };
      cards.set(key, current);
    }

    await wait(1500);
  }

  if (successfulShops === 0 || scrapedCardCount === 0) {
    throw new Error('No shop prices were fetched');
  }

  const output = [...cards.values()]
    .map((card) => recomputeBest(card, date))
    .filter((card) => card.latestPrice > 0)
    .sort((a, b) => b.latestPrice - a.latestPrice || a.modelNo.localeCompare(b.modelNo, 'ja'));

  await mkdir(path.dirname(DATA_PATH), { recursive: true });
  await writeFile(DATA_PATH, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  console.log(`Wrote ${output.length} cards to ${DATA_PATH}`);

  // 健全性の判定は check-scrape-health.mjs に任せる。
  // ここで失敗させると、正常に取れた他店の価格までコミットされなくなるため。
  const reportJson = JSON.stringify(report, null, 2);
  await writeFile(path.join(ROOT, REPORT_PATH), reportJson + LINE_END, 'utf8');
  const broken = report.shops.filter((shop) => !shop.healthy);
  if (broken.length) {
    console.error(`Unhealthy shops: ${broken.map((shop) => shop.id).join(', ')}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
