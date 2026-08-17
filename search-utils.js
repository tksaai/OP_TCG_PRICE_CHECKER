(function exposeSearchUtils(root) {
  'use strict';

  function toKatakana(value) {
    return value.replace(/[\u3041-\u3096]/g, character =>
      String.fromCharCode(character.charCodeAt(0) + 0x60)
    );
  }

  function normalizeSearchText(value) {
    return toKatakana(String(value ?? '').normalize('NFKC'))
      .replace(/\u3000/g, ' ')
      .toUpperCase();
  }

  function compactSearchText(value) {
    return normalizeSearchText(value).replace(/[^\p{L}\p{N}]/gu, '');
  }

  function splitSearchTerms(value) {
    const normalized = normalizeSearchText(value);
    return normalized
      .split(/[^\p{L}\p{N}]+/u)
      .map(term => term.trim())
      .filter(term => [...term].length >= 2);
  }

  function parseSearchQuery(input) {
    const source = String(input ?? '').replace(/\u3000/g, ' ').trim();
    const tokens = source.match(/[-－−]?(?:"[^"]+"|“[^”]+”|\S+)/gu) || [];
    const include = [];
    const exclude = [];

    tokens.forEach(rawToken => {
      const isExclude = /^[-－−]/u.test(rawToken);
      const unprefixed = isExclude ? rawToken.slice(1) : rawToken;
      const unquoted = unprefixed.replace(/^["“]|["”]$/gu, '').trim();
      const normalized = normalizeSearchText(unquoted);
      const compact = compactSearchText(unquoted);
      if (!compact) return;

      const token = { normalized, compact };
      (isExclude ? exclude : include).push(token);
    });

    return { include, exclude };
  }

  function createSearchIndex(card) {
    const details = card?.details || {};
    const shopNames = Object.values(card?.pricesByShop || {})
      .flatMap(shop => [shop?.sourceName, shop?.shopName]);
    const values = [
      card?.name,
      card?.modelNo,
      details.cardName,
      details.furigana,
      details.effectText,
      details.trigger,
      details.attribute,
      details.cardType,
      details.rarity,
      details.seriesTitle,
      ...(Array.isArray(details.features) ? details.features : []),
      ...shopNames,
    ].filter(Boolean);

    const normalizedValues = values.map(normalizeSearchText);
    const terms = new Set();
    values.forEach(value => {
      const compactValue = compactSearchText(value);
      if ([...compactValue].length >= 2) terms.add(compactValue);
      splitSearchTerms(value).forEach(term => terms.add(compactSearchText(term)));
    });

    return {
      text: normalizedValues.join(' '),
      compactText: normalizedValues.map(compactSearchText).join(' '),
      terms: [...terms],
    };
  }

  function editDistanceWithin(left, right, maxDistance) {
    const a = [...left];
    const b = [...right];
    if (Math.abs(a.length - b.length) > maxDistance) return maxDistance + 1;

    let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
    for (let i = 1; i <= a.length; i += 1) {
      const current = [i];
      let rowMinimum = current[0];
      for (let j = 1; j <= b.length; j += 1) {
        const substitutionCost = a[i - 1] === b[j - 1] ? 0 : 1;
        current[j] = Math.min(
          current[j - 1] + 1,
          previous[j] + 1,
          previous[j - 1] + substitutionCost
        );
        rowMinimum = Math.min(rowMinimum, current[j]);
      }
      if (rowMinimum > maxDistance) return maxDistance + 1;
      previous = current;
    }
    return previous[b.length];
  }

  function fuzzyTermMatches(query, candidate) {
    const queryLength = [...query].length;
    const candidateLength = [...candidate].length;
    if (queryLength <= 2) return false;

    const maxDistance = queryLength <= 4 ? 1 : queryLength <= 8 ? 2 : 3;
    if (Math.abs(queryLength - candidateLength) > maxDistance) return false;
    return editDistanceWithin(query, candidate, maxDistance) <= maxDistance;
  }

  function indexMatchesTerm(index, query, allowFuzzy) {
    if (index.text.includes(query.normalized) || index.compactText.includes(query.compact)) {
      return true;
    }
    if (!allowFuzzy) return false;
    return index.terms.some(candidate => fuzzyTermMatches(query.compact, candidate));
  }

  function matchesSearch(index, parsedQuery, mode = 'AND', fuzzy = true) {
    if (parsedQuery.exclude.some(query => indexMatchesTerm(index, query, false))) {
      return false;
    }
    if (parsedQuery.include.length === 0) return true;

    const predicate = query => indexMatchesTerm(index, query, fuzzy);
    return mode === 'OR'
      ? parsedQuery.include.some(predicate)
      : parsedQuery.include.every(predicate);
  }

  root.OPSearchUtils = Object.freeze({
    compactSearchText,
    createSearchIndex,
    editDistanceWithin,
    matchesSearch,
    normalizeSearchText,
    parseSearchQuery,
  });
})(globalThis);
