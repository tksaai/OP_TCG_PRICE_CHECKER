import { fetchText } from './http-fetch.mjs';

const DEFAULT_PAGE_SIZE = 500;
const MAX_PAGES = 100;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function sanitize(value) {
  return String(value ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function toCard(item) {
  const extra = item.extra_difference ? `(${sanitize(item.extra_difference)})` : '';
  return {
    name: `${sanitize(item.name)}${extra}`,
    modelNo: sanitize(item.model_number),
    imageUrl: item.ocha_product?.image_source || item.original_image_source || '',
    price: Number(item.amount || 0),
    rarity: sanitize(item.rarity),
  };
}

export async function scrapeCardrushBuyingPrices(shop, options = {}) {
  const fetchTextImpl = options.fetchTextImpl || fetchText;
  const waitImpl = options.waitImpl || wait;
  const pageSize = Number(options.pageSize || DEFAULT_PAGE_SIZE);
  const recordsById = new Map();
  let page = 1;
  let lastPage = 1;

  do {
    const url = new URL(shop.url);
    url.searchParams.set('displayMode', 'リスト');
    url.searchParams.set('limit', String(pageSize));
    url.searchParams.set('page', String(page));

    const text = await fetchTextImpl(url.href, { headers: shop.headers });
    let payload;
    try {
      payload = JSON.parse(text);
    } catch (error) {
      throw new Error(`Cardrush API page ${page} returned invalid JSON`, { cause: error });
    }

    if (payload?.result !== true || !Array.isArray(payload.records)) {
      throw new Error(`Cardrush API page ${page} returned an invalid response`);
    }

    const reportedLastPage = Number(payload.last_page || 1);
    if (!Number.isInteger(reportedLastPage) || reportedLastPage < page || reportedLastPage > MAX_PAGES) {
      throw new Error(`Cardrush API returned invalid last_page: ${payload.last_page}`);
    }
    lastPage = reportedLastPage;

    payload.records.forEach((item, index) => {
      const id = item.id == null ? `page:${page}:index:${index}` : String(item.id);
      recordsById.set(id, item);
    });

    page += 1;
    if (page <= lastPage) await waitImpl(250);
  } while (page <= lastPage);

  return [...recordsById.values()]
    .map(toCard)
    .filter((card) => card.name && card.modelNo && card.price > 0);
}
