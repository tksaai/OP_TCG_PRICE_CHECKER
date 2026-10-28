import { fetchText } from './http-fetch.mjs';

const PAUSED_MESSAGE = '公式サイトで店頭買取・宅配買取を休止中';

function stripControlChars(value) {
  let result = '';
  for (const char of String(value ?? '')) {
    const code = char.codePointAt(0);
    result += code < 32 || code === 127 ? ' ' : char;
  }
  return result;
}

function stripTags(value) {
  return stripControlChars(value)
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

function attributeOf(tag, name) {
  const match = String(tag || '').match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i'));
  return match?.[2] || '';
}

export function extractTorecardModel(name) {
  const matches = String(name || '').match(/(?:OP|ST|EB|PRB)\d{2}-\d{3}|P-\d{3}/gi);
  return matches ? matches[matches.length - 1].toUpperCase() : '';
}

export function isTorecardPaused(html) {
  const text = stripTags(html);
  return /(?:店頭買取・宅配買取|買取)を休止しております/u.test(text);
}

export function parseTorecardBuyingPage(html, baseUrl) {
  if (isTorecardPaused(html)) {
    return { status: 'paused', message: PAUSED_MESSAGE, cards: [] };
  }

  const cards = [];
  const itemRegex = /<li\b[^>]*class=["'][^"']*\blist-group-item\b[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi;
  let itemMatch;

  while ((itemMatch = itemRegex.exec(String(html || ''))) !== null) {
    const block = itemMatch[1];
    const imageTag = block.match(/<img\b(?=[^>]*class=["'][^"']*\bcard-list-img\b[^"']*["'])[^>]*>/i)?.[0] || '';
    const priceHtml = block.match(/<div\b[^>]*class=["'][^"']*\bcard-list-price\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] || '';
    const nameHtml = block.match(/<div\b[^>]*class=["'][^"']*\bcard-list-name\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] || '';
    const name = stripTags(nameHtml || attributeOf(imageTag, 'alt'));
    const src = attributeOf(imageTag, 'src');
    const price = Number((stripTags(priceHtml).match(/([\d,]+)\s*円/u)?.[1] || '').replace(/,/g, ''));
    const modelNo = extractTorecardModel(name);
    const imageUrl = src ? new URL(src, baseUrl).href : '';

    if (name && modelNo && price > 0) cards.push({ name, modelNo, imageUrl, price });
  }

  return { status: 'active', message: '', cards };
}

export async function scrapeTorecardBuyingPrices(shop, dependencies = {}) {
  const fetchImpl = dependencies.fetchText || fetchText;
  const html = await fetchImpl(shop.url, { headers: shop.headers });
  return parseTorecardBuyingPage(html, shop.url);
}
