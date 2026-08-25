import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 参照先は sync-db-catalog.mjs と揃える (OP_TCG_DB_ROOT で差し替え可能)
const DB_ROOT = globalThis.process?.env?.OP_TCG_DB_ROOT || 'https://tksaai.github.io/OP_TCG_DB';
const DEFAULT_SOURCE = `${DB_ROOT}/cards.json`;
const runtimeProcess = globalThis.process;

export async function loadSource(location) {
  if (/^https?:\/\//i.test(location)) {
    const response = await fetch(location, {
      headers: { 'user-agent': 'OP_TCG_PRICE_CHECKER card detail sync' },
    });
    if (!response.ok) {
      throw new Error(`Failed to download card details: HTTP ${response.status}`);
    }
    return response.json();
  }

  return JSON.parse(await readFile(path.resolve(location), 'utf8'));
}

export function validateCards(cards) {
  if (!Array.isArray(cards) || cards.length === 0) {
    throw new Error('Card detail source did not contain a non-empty array.');
  }

  const validCards = cards.filter(card => card && typeof card.cardNumber === 'string' && card.cardNumber.trim());
  if (validCards.length < 100) {
    throw new Error(`Card detail source looks incomplete (${validCards.length} cards).`);
  }
  return validCards;
}

export async function syncCardDetails(source, output) {
  const validCards = validateCards(await loadSource(source));
  const outputPath = path.resolve(output);
  await writeFile(outputPath, `${JSON.stringify(validCards, null, 2)}\n`, 'utf8');
  return { count: validCards.length, outputPath };
}

const isMain = runtimeProcess?.argv?.[1]
  && path.resolve(runtimeProcess.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  const source = runtimeProcess.argv[2] || runtimeProcess.env.OP_TCG_DB_CARDS_URL || DEFAULT_SOURCE;
  const output = runtimeProcess.argv[3] || 'data/card-details.json';
  const result = await syncCardDetails(source, output);
  console.log(`Synced ${result.count} card details to ${result.outputPath}`);
}
