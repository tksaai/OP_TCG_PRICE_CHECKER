(function initAliasReviewUtils(global) {
  'use strict';

  function distinctShopCount(candidate) {
    return new Set((candidate.records || []).map((record) => record.shopId).filter(Boolean)).size;
  }

  function candidateSafety(candidate) {
    const reasons = [];
    const shops = distinctShopCount(candidate);
    const warnings = candidate.warnings || [];
    const priceRatio = candidate.priceStats?.ratio;
    const imagePairs = candidate.imageStats?.pairCount || 0;
    const imageMin = candidate.imageStats?.min;

    if (candidate.conditionConflict) reasons.push('開封済み・未開封が混在');
    if (candidate.riskLevel !== 'low') reasons.push(`リスク判定が${candidate.riskLevel || '不明'}`);
    if (warnings.length) reasons.push('警告項目あり');
    if (shops < 3) reasons.push('一致店舗が3店舗未満');
    if (priceRatio == null || priceRatio > 2) reasons.push('価格差が2倍超または比較不能');
    if (!imagePairs) reasons.push('店舗間の画像比較データなし');
    else if (imageMin == null || imageMin < 80) reasons.push('画像類似度が80未満');

    return {
      safe: reasons.length === 0,
      reasons,
      shops,
      priceRatio: priceRatio ?? null,
      imagePairs,
      imageMin: imageMin ?? null,
    };
  }

  function groupIdentity(group) {
    if (group?.candidateId) return `candidate:${group.candidateId}`;
    if (group?.canonicalId) return `canonical:${group.canonicalId}`;
    return '';
  }

  function mergeAliasGroups(existingGroups, incomingGroups) {
    const output = (existingGroups || []).map((group) => ({ ...group }));
    const indexByCandidate = new Map();
    const indexByCanonical = new Map();

    output.forEach((group, index) => {
      if (group.candidateId) indexByCandidate.set(group.candidateId, index);
      if (group.canonicalId) indexByCanonical.set(group.canonicalId, index);
    });

    for (const incoming of incomingGroups || []) {
      if (!incoming?.canonicalId || !Array.isArray(incoming.aliases) || incoming.aliases.length < 2) continue;
      const matchedIndex = incoming.candidateId && indexByCandidate.has(incoming.candidateId)
        ? indexByCandidate.get(incoming.candidateId)
        : indexByCanonical.get(incoming.canonicalId);

      if (matchedIndex == null) {
        const nextIndex = output.length;
        output.push({ ...incoming });
        if (incoming.candidateId) indexByCandidate.set(incoming.candidateId, nextIndex);
        indexByCanonical.set(incoming.canonicalId, nextIndex);
      } else {
        output[matchedIndex] = { ...incoming };
        if (incoming.candidateId) indexByCandidate.set(incoming.candidateId, matchedIndex);
        indexByCanonical.set(incoming.canonicalId, matchedIndex);
      }
    }

    return output;
  }

  const api = {
    candidateSafety,
    distinctShopCount,
    groupIdentity,
    mergeAliasGroups,
  };

  global.OPAliasReviewUtils = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
