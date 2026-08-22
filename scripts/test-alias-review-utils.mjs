import assert from 'node:assert/strict';
import '../alias-review-utils.js';

const { candidateSafety, mergeAliasGroups } = globalThis.OPAliasReviewUtils;

function safeCandidate(overrides = {}) {
  return {
    riskLevel: 'low',
    warnings: [],
    conditionConflict: false,
    priceStats: { ratio: 1.5 },
    imageStats: { pairCount: 1, min: 85 },
    records: [
      { shopId: 'mercard' },
      { shopId: 'cardrush' },
      { shopId: 'torecard' },
    ],
    ...overrides,
  };
}

assert.equal(candidateSafety(safeCandidate()).safe, true);
assert.equal(candidateSafety(safeCandidate({ conditionConflict: true })).safe, false);
assert.equal(candidateSafety(safeCandidate({ records: [{ shopId: 'mercard' }, { shopId: 'cardrush' }] })).safe, false);
assert.equal(candidateSafety(safeCandidate({ priceStats: { ratio: 2.1 } })).safe, false);
assert.equal(candidateSafety(safeCandidate({ imageStats: { pairCount: 0, min: null } })).safe, false);
assert.equal(candidateSafety(safeCandidate({ imageStats: { pairCount: 1, min: 79 } })).safe, false);

const existing = [
  { canonicalId: 'A', candidateId: 'candidate_a', aliases: [{}, {}], preserved: true },
  { canonicalId: 'B', aliases: [{}, {}] },
];
const merged = mergeAliasGroups(existing, [
  { canonicalId: 'A2', candidateId: 'candidate_a', aliases: [{ id: 1 }, { id: 2 }] },
  { canonicalId: 'C', aliases: [{ id: 3 }, { id: 4 }] },
]);

assert.equal(merged.length, 3);
assert.equal(merged[0].canonicalId, 'A2');
assert.equal(merged[1].canonicalId, 'B');
assert.equal(merged[2].canonicalId, 'C');
assert.equal(existing[0].canonicalId, 'A');

console.log('Alias review utility tests passed.');
