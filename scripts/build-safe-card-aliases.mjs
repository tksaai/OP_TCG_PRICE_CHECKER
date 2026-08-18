// alias-candidates.json から、2026-08-18 に確認した保守的な第1弾だけを
// card-aliases.json へ反映する。既存の人手作成グループは変更しない。

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CANDIDATES_PATH = path.join(ROOT, 'data', 'alias-candidates.json');
const ALIASES_PATH = path.join(ROOT, 'data', 'card-aliases.json');
const CARDS_PATH = path.join(ROOT, 'data', 'cards.json');
const REPORT_PATH = path.join(ROOT, 'data', 'card-alias-review-report.json');

const NORMALIZATION_SOURCE = 'safe-candidate-review-2026-08-18-v1';

// 3店舗一致・価格差2倍以内・画像類似度80以上・警告なしを満たし、
// 代表的なカード種別を店舗画像でも目視確認したバッチ。
export const REVIEWED_CANDIDATE_IDS = Object.freeze([
  'candidate_EB01-046_parallel',
  'candidate_EB01-057_parallel_sp',
  'candidate_EB02-035_parallel',
  'candidate_EB02-052_parallel_sp',
  'candidate_EB03-003_parallel_sp',
  'candidate_EB03-018_parallel_sp',
  'candidate_EB03-024_parallel_sp',
  'candidate_EB03-026_parallel_sp',
  'candidate_EB03-031_parallel_sp',
  'candidate_EB03-042_parallel_sp',
  'candidate_EB03-045_parallel_sp',
  'candidate_EB03-053_parallel_sp',
  'candidate_EB03-055_parallel_sp',
  'candidate_EB04-058_parallel',
  'candidate_EB04-061_parallel',
  'candidate_OP01-025_parallel',
  'candidate_OP01-094_parallel',
  'candidate_OP01-120_comic',
  'candidate_OP02-013_comic',
  'candidate_OP03-122_comic',
  'candidate_OP04-064_parallel_sp',
  'candidate_OP04-083_comic',
  'candidate_OP06-093_parallel_sp',
  'candidate_OP06-101_parallel_sp',
  'candidate_OP06-119_parallel_sp',
  'candidate_OP07-085_parallel_sp',
  'candidate_OP09-050_parallel',
  'candidate_OP09-071_judge_promo',
  'candidate_OP09-118_comic',
  'candidate_OP12-014_parallel_sp',
  'candidate_OP12-030_parallel_sp',
  'candidate_OP13-031_parallel_sp',
  'candidate_OP13-042_parallel_sp',
  'candidate_OP14-031_parallel',
  'candidate_OP14-112_parallel',
  'candidate_OP14-112_parallel_sp',
  'candidate_OP15-119_parallel',
  'candidate_OP16-015_parallel',
  'candidate_OP16-032_parallel',
  'candidate_OP16-063_comic',
  'candidate_OP16-065_comic',
  'candidate_OP16-073_comic',
  'candidate_OP16-119_parallel',
  'candidate_P-105_parallel_sp',
  'candidate_ST01-012_wanted',
  'candidate_ST13-011_parallel_sp',
  'candidate_ST15-002_parallel_sp',
  'candidate_ST16-004_parallel_sp',
  'candidate_ST18-004_parallel_sp',
  'candidate_ST18-005_parallel_sp',
  'candidate_ST26-005_parallel_sp',
]);

const VISUALLY_REVIEWED_IDS = new Set([
  'candidate_OP01-120_comic',
  'candidate_OP02-013_comic',
  'candidate_OP03-122_comic',
  'candidate_OP04-083_comic',
  'candidate_EB03-003_parallel_sp',
  'candidate_EB01-046_parallel',
  'candidate_OP09-071_judge_promo',
  'candidate_ST01-012_wanted',
]);

function uniqueShopCount(candidate) {
  return new Set(candidate.records.map((record) => record.shopId)).size;
}

function assertSafeCandidate(candidate) {
  const problems = [];
  if (candidate.riskLevel !== 'low') problems.push(`riskLevel=${candidate.riskLevel}`);
  if (candidate.conditionConflict) problems.push('開封状態の競合あり');
  if ((candidate.warnings || []).length) problems.push('警告あり');
  if (uniqueShopCount(candidate) < 3) problems.push('3店舗未満');
  if (candidate.priceStats?.ratio == null || candidate.priceStats.ratio > 2) {
    problems.push('価格差2倍超または比較不能');
  }
  if (!candidate.imageStats?.pairCount) problems.push('店舗間の画像比較なし');
  if (candidate.imageStats?.min == null || candidate.imageStats.min < 80) {
    problems.push('画像類似度80未満または比較不能');
  }
  if (problems.length) {
    throw new Error(`${candidate.candidateId} は安全条件を満たしません: ${problems.join('、')}`);
  }
}

function deferReasons(candidate, reviewedIds) {
  const reasons = [];
  if (candidate.conditionConflict) reasons.push('開封済み・未開封が混在');
  if (candidate.riskLevel !== 'low') reasons.push(`リスク判定が${candidate.riskLevel}`);
  if ((candidate.warnings || []).length) reasons.push('警告項目あり');
  if (uniqueShopCount(candidate) < 3) reasons.push('一致店舗が3店舗未満');
  if (candidate.priceStats?.ratio == null || candidate.priceStats.ratio > 2) {
    reasons.push('価格差が2倍超または比較不能');
  }
  if (!candidate.imageStats?.pairCount) {
    reasons.push('店舗間の画像比較データなし');
  } else if (candidate.imageStats.min == null || candidate.imageStats.min < 80) {
    reasons.push('画像類似度が80未満');
  }
  if (!reviewedIds.has(candidate.candidateId) && reasons.length === 0) {
    reasons.push('安全条件を満たすが今回の確認バッチ外');
  }
  return reasons;
}

function createAliasGroup(candidate) {
  return {
    canonicalId: candidate.suggestedCanonicalId,
    canonicalName: candidate.canonicalName,
    modelNo: candidate.modelCode,
    normalizationSource: NORMALIZATION_SOURCE,
    candidateId: candidate.candidateId,
    aliases: candidate.records.map((record) => ({
      shopId: record.shopId,
      sourceKey: record.sourceKey,
      name: record.name,
      modelNo: record.modelNo,
    })),
  };
}

function aliasReference(group, alias) {
  return `${group.canonicalId}\u0000${alias.shopId}\u0000${alias.sourceKey}`;
}

function validateGroups(manualGroups, generatedGroups, cards) {
  const canonicalIds = new Set();
  const aliasOwners = new Map();
  const cardKeys = new Set(cards.map((card) => card.key));
  const generatedMatches = [];

  for (const group of [...manualGroups, ...generatedGroups]) {
    if (canonicalIds.has(group.canonicalId)) {
      throw new Error(`canonicalId が重複しています: ${group.canonicalId}`);
    }
    canonicalIds.add(group.canonicalId);

    for (const alias of group.aliases || []) {
      const key = `${alias.shopId}\u0000${alias.sourceKey}`;
      const owner = aliasOwners.get(key);
      if (owner && owner !== group.canonicalId) {
        throw new Error(`同じ店舗・sourceKeyが複数グループにあります: ${alias.shopId} ${alias.sourceKey}`);
      }
      aliasOwners.set(key, group.canonicalId);
    }
  }

  for (const group of generatedGroups) {
    const matchedKeys = new Set(
      group.aliases
        .filter((alias) => cardKeys.has(alias.sourceKey))
        .map((alias) => alias.sourceKey)
    );
    if (matchedKeys.size < 2) {
      throw new Error(`${group.canonicalId} は現在のcards.jsonで2件以上を統合できません`);
    }
    generatedMatches.push({ canonicalId: group.canonicalId, matchedCardKeys: matchedKeys.size });
  }

  return {
    canonicalIds: canonicalIds.size,
    aliasReferences: [...manualGroups, ...generatedGroups]
      .flatMap((group) => (group.aliases || []).map((alias) => aliasReference(group, alias))).length,
    generatedMatches,
  };
}

export async function buildSafeCardAliases({ write = true } = {}) {
  const [candidates, currentAliases, cards] = await Promise.all([
    readFile(CANDIDATES_PATH, 'utf8').then(JSON.parse),
    readFile(ALIASES_PATH, 'utf8').then(JSON.parse),
    readFile(CARDS_PATH, 'utf8').then(JSON.parse),
  ]);
  const candidatesById = new Map(candidates.map((candidate) => [candidate.candidateId, candidate]));
  const reviewedIds = new Set(REVIEWED_CANDIDATE_IDS);
  const missingIds = REVIEWED_CANDIDATE_IDS.filter((id) => !candidatesById.has(id));
  if (missingIds.length) throw new Error(`候補JSONに存在しない確認済みID: ${missingIds.join(', ')}`);

  const selectedCandidates = REVIEWED_CANDIDATE_IDS.map((id) => candidatesById.get(id));
  selectedCandidates.forEach(assertSafeCandidate);

  const manualGroups = currentAliases.filter(
    (group) => group.normalizationSource !== NORMALIZATION_SOURCE
  );
  const manualCanonicalIds = new Set(manualGroups.map((group) => group.canonicalId));
  const generatedGroups = selectedCandidates.map(createAliasGroup);
  const collisions = generatedGroups
    .map((group) => group.canonicalId)
    .filter((canonicalId) => manualCanonicalIds.has(canonicalId));
  if (collisions.length) throw new Error(`既存canonicalIdと衝突しています: ${collisions.join(', ')}`);

  const validation = validateGroups(manualGroups, generatedGroups, cards);
  const outputAliases = [...manualGroups, ...generatedGroups];
  const deferred = candidates
    .filter((candidate) => !reviewedIds.has(candidate.candidateId))
    .map((candidate) => ({
      candidateId: candidate.candidateId,
      modelCode: candidate.modelCode,
      signature: candidate.signature,
      riskLevel: candidate.riskLevel,
      shops: uniqueShopCount(candidate),
      imageMin: candidate.imageStats?.min ?? null,
      imagePairCount: candidate.imageStats?.pairCount ?? 0,
      priceRatio: candidate.priceStats?.ratio ?? null,
      reasons: deferReasons(candidate, reviewedIds),
    }));
  const deferredCountsByReason = {};
  for (const item of deferred) {
    for (const reason of item.reasons) {
      deferredCountsByReason[reason] = (deferredCountsByReason[reason] || 0) + 1;
    }
  }

  const report = {
    schemaVersion: 1,
    reviewBatch: NORMALIZATION_SOURCE,
    policy: {
      distinctShopsAtLeast: 3,
      riskLevel: 'low',
      conditionConflict: false,
      warnings: 0,
      priceRatioAtMost: 2,
      crossShopImagePairsAtLeast: 1,
      imageSimilarityMinAtLeast: 80,
      note: '画像は同一性の補助証拠。カード番号・属性・開封状態を優先し、SAMPLE透かしや画像サイズの差は店舗差として扱う。',
    },
    visualReview: {
      candidateIds: [...VISUALLY_REVIEWED_IDS],
      categories: ['コミック背景・旧弾ロゴ差', 'SPパラレル', '通常パラレル', 'JUDGEプロモ', 'WANTED'],
      result: '店舗間で同じカード番号・同じ絵柄を確認',
    },
    summary: {
      totalCandidates: candidates.length,
      preservedManualGroups: manualGroups.length,
      acceptedCandidates: selectedCandidates.length,
      deferredCandidates: deferred.length,
      outputAliasGroups: outputAliases.length,
    },
    accepted: selectedCandidates.map((candidate) => ({
      candidateId: candidate.candidateId,
      canonicalId: candidate.suggestedCanonicalId,
      modelCode: candidate.modelCode,
      signature: candidate.signature,
      shops: uniqueShopCount(candidate),
      imageMin: candidate.imageStats.min,
      imagePairCount: candidate.imageStats.pairCount,
      priceRatio: candidate.priceStats.ratio,
      visuallyReviewedRepresentative: VISUALLY_REVIEWED_IDS.has(candidate.candidateId),
    })),
    deferredCountsByReason,
    deferred,
    validation,
  };

  if (write) {
    await Promise.all([
      writeFile(ALIASES_PATH, `${JSON.stringify(outputAliases, null, 2)}\n`, 'utf8'),
      writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, 'utf8'),
    ]);
  }

  return { aliases: outputAliases, report, validation };
}

const runtimeProcess = globalThis.process;
const isMain = runtimeProcess?.argv?.[1]
  ? path.resolve(runtimeProcess.argv[1]) === fileURLToPath(import.meta.url)
  : false;

if (isMain) {
  buildSafeCardAliases()
    .then(({ report }) => {
      console.log(
        `Accepted ${report.summary.acceptedCandidates} candidates; ` +
          `wrote ${report.summary.outputAliasGroups} alias groups.`
      );
    })
    .catch((error) => {
      console.error(error);
      runtimeProcess.exitCode = 1;
    });
}
