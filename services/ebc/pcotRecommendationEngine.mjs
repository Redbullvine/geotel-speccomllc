/**
 * EBC — What-If comparison and PCOT recommendation solver.
 *
 * Both entry points work by re-running the whole cascade with a ratio override.
 * They never touch the caller's leg object, so field data and design data are
 * safe: a comparison is a projection, not an edit. Nothing here writes back.
 *
 * Downstream protection
 * ---------------------
 * A candidate is only allowed if, for EVERY location downstream of the one
 * being changed:
 *   1. it does not FAIL, and
 *   2. it is not worse than that same location is under the current design.
 *
 * Rule 2 is what stops the solver trading a healthy end of leg for a stronger
 * local tap. Because a candidate is scored on a full recalculation rather than
 * on the device in isolation, a change that merely moves the problem downstream
 * cannot score as a fix.
 */

import { EBC_PROVENANCE } from "./provenance.mjs";
import { DEFAULT_PCOT_SPECS, getPcotSpec, parseRatio, usableRatios } from "./pcotSpecs.mjs";
import { EBC_STATUS, calculateLeg, downstreamNodes, findNodeResult } from "./opticalBudgetEngine.mjs";
import { EBC_CONFIDENCE } from "./validation.mjs";

export const EBC_RECOMMENDATION_OUTCOME = Object.freeze({
  NO_CHANGE_REQUIRED: "NO_CHANGE_REQUIRED",
  CHANGE_RECOMMENDED: "CHANGE_RECOMMENDED",
  NO_SAFE_PCOT_CHANGE: "NO_SAFE_PCOT_CHANGE",
  INSUFFICIENT_DATA: "INSUFFICIENT_DATA",
});

export const DEFAULT_CONSTRAINTS = Object.freeze({
  /** The local tap must reach this status for a candidate to qualify. */
  requireLocalStatus: EBC_STATUS.PASS,
  /** No downstream location may end up worse than this. */
  maxDownstreamStatus: EBC_STATUS.MARGINAL,
  /** May a downstream location be worse than it is under the current design? */
  allowDownstreamDegradation: false,
});

const STATUS_RANK = { PASS: 0, MARGINAL: 1, UNKNOWN: 2, FAIL: 3 };
const rank = (status) => (STATUS_RANK[status] === undefined ? STATUS_RANK.UNKNOWN : STATUS_RANK[status]);
const round2 = (value) => (value === null || value === undefined || !Number.isFinite(Number(value)) ? null : Number(Number(value).toFixed(2)));
const diff = (a, b) => (a === null || b === null || a === undefined || b === undefined ? null : round2(a - b));

/** Tap aggressiveness: how far a candidate moves from the ratio in the ground. */
function aggressiveness(candidateRatio, currentRatio){
  const candidate = parseRatio(candidateRatio);
  const current = parseRatio(currentRatio);
  if (!candidate || !current) return Number.POSITIVE_INFINITY;
  return Math.abs(candidate.tapPercent - current.tapPercent);
}

/**
 * Score one candidate ratio at one location by recalculating the entire leg.
 * `baseline` is the result of the untouched leg, used for the comparison and
 * for the "must not get worse" downstream rule.
 */
export function evaluateCandidate(leg, nodeId, ratio, baseline, options = {}){
  const { specs = DEFAULT_PCOT_SPECS, constraints = DEFAULT_CONSTRAINTS } = options;
  const merged = { ...DEFAULT_CONSTRAINTS, ...constraints };

  const projected = calculateLeg(leg, {
    ...options,
    specs,
    ratioOverrides: { ...(options.ratioOverrides || {}), [nodeId]: ratio },
  });

  const local = findNodeResult(projected, nodeId);
  const baseLocal = findNodeResult(baseline, nodeId);
  const downstream = downstreamNodes(projected, nodeId);
  const baseDownstreamById = new Map(downstreamNodes(baseline, nodeId).map((node) => [node.id, node]));

  const spec = getPcotSpec(ratio, specs);
  const parsed = parseRatio(ratio);

  const downstreamIssues = [];
  for (const node of downstream){
    if (node.marginDb === null && node.status === EBC_STATUS.UNKNOWN && node.statusCode === "PASS_THROUGH") continue;
    const before = baseDownstreamById.get(node.id) || null;
    if (rank(node.status) > rank(merged.maxDownstreamStatus)){
      downstreamIssues.push({
        nodeId: node.id, label: node.label, status: node.status, marginDb: node.marginDb,
        code: "BELOW_ALLOWED_STATUS",
        detail: node.label + " would be " + node.status + " at " + node.marginDb + " dB margin.",
      });
      continue;
    }
    if (!merged.allowDownstreamDegradation && before && rank(node.status) > rank(before.status)){
      downstreamIssues.push({
        nodeId: node.id, label: node.label, status: node.status, marginDb: node.marginDb,
        code: "DEGRADES_DOWNSTREAM",
        detail: node.label + " would drop from " + before.status + " to " + node.status + ".",
      });
    }
  }

  const weakestDownstream = downstream.filter((node) => node.marginDb !== null)
    .reduce((worst, node) => (worst === null || node.marginDb < worst.marginDb ? node : worst), null);

  const localOk = Boolean(local) && rank(local.status) <= rank(merged.requireLocalStatus);
  const feasible = Boolean(local) && local.specUsable !== false && localOk && downstreamIssues.length === 0;

  return Object.freeze({
    ratio,
    tapPercent: parsed ? parsed.tapPercent : null,
    throughPercent: parsed ? parsed.throughPercent : null,
    specStatus: spec ? spec.status : "SPECIFICATION_REQUIRED",
    specVerified: Boolean(spec && spec.verified),

    predictedTapDbm: local ? local.tapOutputDbm : null,
    predictedTapDeliveredDbm: local ? local.tapDeliveredDbm : null,
    tapImprovementDb: diff(local ? local.deliveredRawDbm : null, baseLocal ? baseLocal.deliveredRawDbm : null),
    predictedThroughDbm: local ? local.throughOutputDbm : null,
    downstreamPenaltyDb: diff(local ? local.throughOutputRawDbm : null, baseLocal ? baseLocal.throughOutputRawDbm : null),

    localMarginDb: local ? local.marginDb : null,
    localStatus: local ? local.status : EBC_STATUS.UNKNOWN,
    localStatusReason: local ? local.statusReason : "",

    weakestDownstream: weakestDownstream
      ? { nodeId: weakestDownstream.id, label: weakestDownstream.label, marginDb: weakestDownstream.marginDb, status: weakestDownstream.status }
      : null,
    endOfLegPowerDbm: projected.endOfLeg.powerDbm,
    endOfLegMarginDb: projected.endOfLeg.marginDb,
    endOfLegStatus: projected.endOfLeg.status,

    allDownstreamWithinLimits: downstreamIssues.length === 0,
    downstreamIssues: Object.freeze(downstreamIssues),
    legStatus: projected.status,
    feasible,
    aggressiveness: aggressiveness(ratio, baseLocal ? baseLocal.ratioUsed : null),
    confidence: projected.confidence,
    provenance: EBC_PROVENANCE.CALCULATED,
    result: projected,
  });
}

/**
 * "What If I Change This PCOT?"
 *
 * Returns before/after figures for each candidate. Nothing is applied: the
 * caller decides whether to accept, and only then writes to its own store.
 */
export function whatIf(leg, nodeId, candidateRatios, options = {}){
  const { specs = DEFAULT_PCOT_SPECS, lossBasis = "nominal" } = options;
  const baseline = calculateLeg(leg, { ...options, specs });
  const current = findNodeResult(baseline, nodeId);

  if (!current){
    return Object.freeze({
      ok: false, outcome: EBC_RECOMMENDATION_OUTCOME.INSUFFICIENT_DATA, nodeId,
      reason: "No location with id " + String(nodeId) + " exists on this leg.",
      baseline, current: null, candidates: Object.freeze([]),
    });
  }

  const requested = Array.isArray(candidateRatios) && candidateRatios.length
    ? candidateRatios
    : usableRatios(specs, { lossBasis });

  const candidates = requested.map((ratio) => {
    const spec = getPcotSpec(ratio, specs);
    if (!spec || spec.nominalTapLossDb === null || spec.nominalThroughLossDb === null){
      return Object.freeze({
        ratio, feasible: false, usable: false,
        specStatus: spec ? spec.status : "SPECIFICATION_REQUIRED",
        blockedReason: "No insertion-loss specification is configured for " + ratio + ", so it cannot be compared.",
        predictedTapDbm: null, tapImprovementDb: null, predictedThroughDbm: null,
        downstreamPenaltyDb: null, weakestDownstream: null, endOfLegMarginDb: null,
        allDownstreamWithinLimits: false, localStatus: EBC_STATUS.UNKNOWN,
      });
    }
    return { ...evaluateCandidate(leg, nodeId, ratio, baseline, { ...options, specs }), usable: true, blockedReason: "" };
  });

  return Object.freeze({
    ok: baseline.ok,
    outcome: baseline.ok ? "COMPARED" : EBC_RECOMMENDATION_OUTCOME.INSUFFICIENT_DATA,
    nodeId,
    label: current.label,
    baseline,
    current: Object.freeze({
      ratio: current.ratioUsed,
      ratioSource: current.ratioSource,
      inputDbm: current.inputDbm,
      throughOutputDbm: current.throughOutputDbm,
      tapOutputDbm: current.tapOutputDbm,
      tapDeliveredDbm: current.tapDeliveredDbm,
      marginDb: current.marginDb,
      status: current.status,
    }),
    candidates: Object.freeze(candidates),
    missing: baseline.validation.missingSummary,
    confidence: baseline.confidence,
    note: "Projection only. Designed ratio, installed ratio and field readings are unchanged until the change is explicitly accepted.",
    provenance: EBC_PROVENANCE.CALCULATED,
  });
}

/**
 * Automatic PCOT recommendation.
 *
 * Evaluates every configured ratio across the full cascade and prefers the
 * least aggressive change that satisfies the local tap AND every downstream
 * location. The strongest tap is explicitly not the winner.
 */
export function recommendPcot(leg, nodeId, options = {}){
  const { specs = DEFAULT_PCOT_SPECS, lossBasis = "nominal", constraints = DEFAULT_CONSTRAINTS } = options;
  const merged = { ...DEFAULT_CONSTRAINTS, ...constraints };
  const baseline = calculateLeg(leg, { ...options, specs });
  const current = findNodeResult(baseline, nodeId);

  if (!baseline.ok){
    return Object.freeze({
      ok: false,
      outcome: EBC_RECOMMENDATION_OUTCOME.INSUFFICIENT_DATA,
      status: EBC_STATUS.UNKNOWN,
      nodeId,
      label: current ? current.label : "",
      currentPcot: current ? current.ratioUsed : null,
      recommendedPcot: null,
      reason: "The EBC cannot recommend a ratio until the missing engineering inputs are supplied.",
      missing: baseline.validation.missingSummary,
      confidence: EBC_CONFIDENCE.INSUFFICIENT,
      candidates: Object.freeze([]),
      limitingLocation: null,
      provenance: EBC_PROVENANCE.RECOMMENDED,
    });
  }

  if (!current){
    return Object.freeze({
      ok: false,
      outcome: EBC_RECOMMENDATION_OUTCOME.INSUFFICIENT_DATA,
      status: EBC_STATUS.UNKNOWN,
      nodeId, label: "", currentPcot: null, recommendedPcot: null,
      reason: "No location with id " + String(nodeId) + " exists on this leg.",
      missing: Object.freeze(["Location " + String(nodeId) + " is not part of this cascade."]),
      confidence: EBC_CONFIDENCE.INSUFFICIENT,
      candidates: Object.freeze([]), limitingLocation: null,
      provenance: EBC_PROVENANCE.RECOMMENDED,
    });
  }

  const ratios = usableRatios(specs, { lossBasis });
  const evaluated = ratios.map((ratio) => evaluateCandidate(leg, nodeId, ratio, baseline, { ...options, specs, constraints: merged }));
  const feasible = evaluated.filter((candidate) => candidate.feasible);

  const currentCandidate = evaluated.find((candidate) => candidate.ratio === current.ratioUsed) || null;
  const currentIsFeasible = Boolean(currentCandidate && currentCandidate.feasible);

  if (!feasible.length){
    const limiting = findLimitingLocation(evaluated, merged);
    return Object.freeze({
      ok: true,
      outcome: EBC_RECOMMENDATION_OUTCOME.NO_SAFE_PCOT_CHANGE,
      status: EBC_STATUS.FAIL,
      nodeId,
      label: current.label,
      currentPcot: current.ratioUsed,
      recommendedPcot: null,
      currentTapOutputDbm: current.tapOutputDbm,
      currentTapDeliveredDbm: current.tapDeliveredDbm,
      predictedTapOutputDbm: null,
      tapImprovementDb: null,
      currentThroughOutputDbm: current.throughOutputDbm,
      predictedThroughOutputDbm: null,
      downstreamPenaltyDb: null,
      weakestDownstream: baseline.weakest,
      endOfLegMarginDb: baseline.endOfLeg.marginDb,
      remainingEndOfLegMarginDb: baseline.endOfLeg.marginDb,
      limitingLocation: limiting,
      reason: limiting
        ? "NO SAFE PCOT CHANGE. No configured ratio satisfies " + current.label + " without pushing " + limiting.label + " past its limit."
        : "NO SAFE PCOT CHANGE. No configured ratio satisfies the local tap and the rest of the cascade at the same time.",
      changeRequired: false,
      missing: baseline.validation.missingSummary,
      confidence: baseline.confidence,
      candidates: Object.freeze(evaluated.map(stripResult)),
      provenance: EBC_PROVENANCE.RECOMMENDED,
    });
  }

  // Prefer the least aggressive change; then the smallest downstream penalty;
  // then the healthier local margin. Never "whichever taps hardest".
  const ranked = [...feasible].sort((a, b) => {
    if (a.aggressiveness !== b.aggressiveness) return a.aggressiveness - b.aggressiveness;
    const penaltyA = a.downstreamPenaltyDb === null ? 0 : Math.abs(a.downstreamPenaltyDb);
    const penaltyB = b.downstreamPenaltyDb === null ? 0 : Math.abs(b.downstreamPenaltyDb);
    if (penaltyA !== penaltyB) return penaltyA - penaltyB;
    return (b.localMarginDb ?? -Infinity) - (a.localMarginDb ?? -Infinity);
  });

  const winner = currentIsFeasible ? currentCandidate : ranked[0];
  const changeRequired = winner.ratio !== current.ratioUsed;

  return Object.freeze({
    ok: true,
    outcome: changeRequired ? EBC_RECOMMENDATION_OUTCOME.CHANGE_RECOMMENDED : EBC_RECOMMENDATION_OUTCOME.NO_CHANGE_REQUIRED,
    status: winner.localStatus,
    nodeId,
    label: current.label,
    currentPcot: current.ratioUsed,
    recommendedPcot: winner.ratio,
    currentTapOutputDbm: current.tapOutputDbm,
    currentTapDeliveredDbm: current.tapDeliveredDbm,
    predictedTapOutputDbm: winner.predictedTapDbm,
    predictedTapDeliveredDbm: winner.predictedTapDeliveredDbm,
    tapImprovementDb: winner.tapImprovementDb,
    currentThroughOutputDbm: current.throughOutputDbm,
    predictedThroughOutputDbm: winner.predictedThroughDbm,
    downstreamPenaltyDb: winner.downstreamPenaltyDb,
    weakestDownstream: winner.weakestDownstream,
    endOfLegMarginDb: baseline.endOfLeg.marginDb,
    remainingEndOfLegMarginDb: winner.endOfLegMarginDb,
    limitingLocation: null,
    changeRequired,
    reason: buildReason({ current, winner, changeRequired, constraints: merged }),
    missing: baseline.validation.missingSummary,
    confidence: winner.confidence,
    specVerified: winner.specVerified,
    candidates: Object.freeze(evaluated.map(stripResult)),
    provenance: EBC_PROVENANCE.RECOMMENDED,
  });
}

function stripResult(candidate){
  const copy = { ...candidate };
  delete copy.result;
  return Object.freeze(copy);
}

function buildReason({ current, winner, changeRequired, constraints }){
  if (!changeRequired){
    return current.ratioUsed + " already meets the local tap at " + current.marginDb + " dB margin with every downstream location inside limits. No change is warranted.";
  }
  const improvement = winner.tapImprovementDb === null ? "an improved tap" : (winner.tapImprovementDb > 0 ? "+" + winner.tapImprovementDb : String(winner.tapImprovementDb)) + " dB at the tap";
  const penalty = winner.downstreamPenaltyDb === null ? "no measurable downstream penalty" : (winner.downstreamPenaltyDb > 0 ? "+" : "") + winner.downstreamPenaltyDb + " dB downstream";
  const weakest = winner.weakestDownstream ? winner.weakestDownstream.label + " holds at " + winner.weakestDownstream.marginDb + " dB" : "no downstream delivery point is affected";
  return "Least aggressive ratio that reaches " + constraints.requireLocalStatus + " locally: " + improvement + " for " + penalty + ". " + weakest + ".";
}

/**
 * When nothing is safe, name the location that is doing the blocking: the
 * downstream point that most often stops a candidate, tie-broken by the worst
 * margin it reaches.
 */
function findLimitingLocation(evaluated, constraints){
  const tally = new Map();
  for (const candidate of evaluated){
    if (candidate.localStatus && rank(candidate.localStatus) > rank(constraints.requireLocalStatus)) continue;
    for (const issue of candidate.downstreamIssues || []){
      const entry = tally.get(issue.nodeId) || { nodeId: issue.nodeId, label: issue.label, blocks: 0, worstMarginDb: null, status: issue.status, detail: issue.detail };
      entry.blocks += 1;
      if (entry.worstMarginDb === null || (issue.marginDb !== null && issue.marginDb < entry.worstMarginDb)){
        entry.worstMarginDb = issue.marginDb;
        entry.status = issue.status;
        entry.detail = issue.detail;
      }
      tally.set(issue.nodeId, entry);
    }
  }
  if (!tally.size){
    // Nothing downstream blocked; the local tap itself is unreachable.
    return null;
  }
  const entries = [...tally.values()].sort((a, b) => {
    if (b.blocks !== a.blocks) return b.blocks - a.blocks;
    return (a.worstMarginDb ?? Infinity) - (b.worstMarginDb ?? Infinity);
  });
  return Object.freeze(entries[0]);
}
