import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_PCOT_SPECS,
  EBC_RECOMMENDATION_OUTCOME,
  EBC_STATUS,
  calculateLeg,
  compareMeasuredToPredicted,
  computeSpan,
  configurePcotSpec,
  downstreamNodes,
  findNodeResult,
  formatTrace,
  recommendPcot,
  unspecifiedRatios,
  usableRatios,
  whatIf,
} from "../services/ebc/index.mjs";

import { buildNode54Leg, buildNode54Legs, deriveLegPath } from "../services/ebc/node54Legs.mjs";
import { NODE54_TDS_LEGS, NODE54_TDS_SOURCE } from "../services/ebc/node54TdsDesign.mjs";

/* ------------------------------------------------------------------ *
 * Deterministic fixtures. Every number here is chosen, not sampled.
 * ------------------------------------------------------------------ */

/** One PCOT, one span. Launch -8.40 dBm, 90/10 tap. */
function singlePcotLeg(overrides = {}){
  return {
    legId: "FIXTURE_SINGLE",
    label: "Single PCOT fixture",
    wavelengthNm: 1550,
    launch: { powerDbm: -8.4 },
    fiber: { attenuationDbPerKm: 0.25, distanceUnit: "km" },
    defaults: { spliceLossDb: 0.1, connectorLossDb: 0.25 },
    limits: { receiverMinDbm: -28, receiverMaxDbm: -5, engineeringReserveDb: 3 },
    nodes: [
      {
        id: "pcot1", label: "PCOT 2058", type: "pcot",
        designedRatio: "90/10", installedRatio: "90/10",
        span: { distance: 1.24, spliceCount: 2, connectorCount: 1 },
      },
    ],
    ...overrides,
  };
}

/**
 * A cascade where only the FIRST location is short of power, because its tap
 * feeds a long drop. Downstream locations are healthy, which is what makes the
 * downstream-protection rule meaningful: the solver has something to protect.
 *
 * Baseline at the seeded 90/10 values (launch -6, every span 0.60 dB):
 *   A tap -17.10 dBm, delivered -22.60 after a 5.50 dB drop
 *   B tap -18.40   C tap -19.70   end delivered -10.50 minus its own drop
 */
function longDropLeg({ endDropDb = 0, ...overrides } = {}){
  const leg = cascadeLeg(overrides);
  leg.legId = "FIXTURE_LONG_DROP";
  leg.nodes = leg.nodes.map((node) => ({ ...node }));
  leg.nodes[0].tapDrop = { terminalLossDb: 5.5 };
  leg.nodes[3].terminalLossDb = endDropDb;
  return leg;
}

/** Four locations: three PCOTs then a terminal. Used for cascade behaviour. */
function cascadeLeg(overrides = {}){
  return {
    legId: "FIXTURE_CASCADE",
    label: "Cascade fixture",
    wavelengthNm: 1550,
    launch: { powerDbm: -6 },
    fiber: { attenuationDbPerKm: 0.25, distanceUnit: "km" },
    defaults: { spliceLossDb: 0.1, connectorLossDb: 0.25 },
    limits: { receiverMinDbm: -25, receiverMaxDbm: -5, engineeringReserveDb: 3 },
    nodes: [
      { id: "a", label: "PCOT A", type: "pcot", designedRatio: "90/10", installedRatio: "90/10", span: { distance: 1, spliceCount: 1, connectorCount: 1 } },
      { id: "b", label: "PCOT B", type: "pcot", designedRatio: "90/10", installedRatio: "90/10", span: { distance: 1, spliceCount: 1, connectorCount: 1 } },
      { id: "c", label: "PCOT C", type: "pcot", designedRatio: "90/10", installedRatio: "90/10", span: { distance: 1, spliceCount: 1, connectorCount: 1 } },
      { id: "end", label: "Terminal", type: "terminal", span: { distance: 1, spliceCount: 1 }, terminalLossDb: 0.5 },
    ],
    ...overrides,
  };
}

/* ------------------------------------------------------------------ *
 * 1. Single-PCOT calculation
 * ------------------------------------------------------------------ */

test("single PCOT calculation splits through and tap from the same input", () => {
  const result = calculateLeg(singlePcotLeg());
  const node = findNodeResult(result, "pcot1");

  // span = 1.24 km x 0.25 + 2 x 0.10 + 1 x 0.25 = 0.31 + 0.20 + 0.25 = 0.76 dB
  assert.equal(node.span.totalDb.toFixed(2), "0.76");
  assert.equal(node.inputDbm, -9.16);
  // 90/10 seeded values: through 0.7 dB, tap 10.5 dB
  assert.equal(node.throughOutputDbm, -9.86);
  assert.equal(node.tapOutputDbm, -19.66);
  assert.equal(result.ok, true);
});

/* ------------------------------------------------------------------ *
 * 2. Multi-PCOT cascade
 * ------------------------------------------------------------------ */

test("multi-PCOT cascade carries the through output into the next input", () => {
  const result = calculateLeg(cascadeLeg());
  const [a, b, c] = ["a", "b", "c"].map((id) => findNodeResult(result, id));

  // Each span: 1 km x 0.25 + 0.10 + 0.25 = 0.60 dB
  assert.equal(a.span.totalDb.toFixed(2), "0.60");
  assert.equal(a.inputDbm, -6.6);
  assert.equal(a.throughOutputDbm, -7.3);

  // B's input is A's through minus B's span, never the launch power.
  assert.equal(b.inputDbm, -7.9);
  assert.equal(b.throughOutputDbm, -8.6);
  assert.equal(c.inputDbm, -9.2);

  // Every location is present in cascade order.
  assert.deepEqual(result.nodes.map((node) => node.id), ["a", "b", "c", "end"]);
});

/* ------------------------------------------------------------------ *
 * 3. Fiber attenuation
 * ------------------------------------------------------------------ */

test("fiber loss is distance times the attenuation coefficient in either unit", () => {
  const km = computeSpan({ distance: 10 }, { fiber: { attenuationDbPerKm: 0.25, distanceUnit: "km" } });
  assert.equal(km.fiberLossDb.toFixed(2), "2.50");

  // 10 miles at 0.25 dB/km = 16.09344 km x 0.25 = 4.02 dB
  const miles = computeSpan({ distance: 10 }, { fiber: { attenuationDbPerKm: 0.25, distanceUnit: "mi" } });
  assert.equal(miles.fiberLossDb.toFixed(2), "4.02");

  // A per-mile coefficient converts to the same answer.
  const perMile = computeSpan({ distance: 10 }, { fiber: { attenuationDbPerMile: 0.4023, distanceUnit: "mi" } });
  assert.equal(perMile.fiberLossDb.toFixed(2), "4.02");

  // No coefficient means 0 dB and a recorded assumption, never a guess.
  const missing = computeSpan({ distance: 10 }, { fiber: {} });
  assert.equal(missing.fiberLossDb, 0);
  assert.match(missing.assumptions.join(" "), /No attenuation coefficient/);
});

/* ------------------------------------------------------------------ *
 * 4. Splice losses
 * ------------------------------------------------------------------ */

test("splice loss is count times per-splice loss and is retained separately", () => {
  const span = computeSpan({ distance: 0, spliceCount: 4, spliceLossDb: 0.15 }, { fiber: { attenuationDbPerKm: 0.25 } });
  assert.equal(span.spliceLossDb.toFixed(2), "0.60");
  assert.equal(span.spliceCount, 4);
  assert.equal(span.perSpliceDb, 0.15);
  assert.equal(span.connectorLossDb, 0);

  // The leg default applies when the span does not carry its own figure.
  const viaDefault = computeSpan({ spliceCount: 2 }, { fiber: {}, defaults: { spliceLossDb: 0.1 } });
  assert.equal(viaDefault.spliceLossDb.toFixed(2), "0.20");
});

/* ------------------------------------------------------------------ *
 * 5. Connector losses
 * ------------------------------------------------------------------ */

test("connector loss is count times per-connector loss and is retained separately", () => {
  const span = computeSpan({ connectorCount: 3, connectorLossDb: 0.3 }, { fiber: {} });
  assert.equal(span.connectorLossDb.toFixed(2), "0.90");
  assert.equal(span.spliceLossDb, 0);
  assert.equal(span.totalDb.toFixed(2), "0.90");
});

/* ------------------------------------------------------------------ *
 * 6. Through versus tap
 * ------------------------------------------------------------------ */

test("through and tap are both derived from the PCOT input, and only through continues", () => {
  const result = calculateLeg(cascadeLeg());
  const a = findNodeResult(result, "a");
  const b = findNodeResult(result, "b");

  const spec = DEFAULT_PCOT_SPECS["90/10"];
  assert.equal(Number((a.inputDbm - spec.nominalThroughLossDb).toFixed(2)), a.throughOutputDbm);
  assert.equal(Number((a.inputDbm - spec.nominalTapLossDb).toFixed(2)), a.tapOutputDbm);

  // The cascade continues on THROUGH, not on TAP.
  assert.equal(b.upstreamDbm, a.throughOutputDbm);
  assert.notEqual(b.upstreamDbm, a.tapOutputDbm);
});

/* ------------------------------------------------------------------ *
 * 7. Changing an upstream PCOT recalculates downstream
 * ------------------------------------------------------------------ */

test("changing an upstream PCOT ratio recalculates every downstream location", () => {
  const leg = cascadeLeg();
  const before = calculateLeg(leg);
  const after = calculateLeg(leg, { ratioOverrides: { a: "60/40" } });

  // 90/10 through loss 0.7 -> 60/40 through loss 2.6 = 1.9 dB more loss.
  const delta = Number((2.6 - 0.7).toFixed(2));

  for (const id of ["b", "c", "end"]){
    const nodeBefore = findNodeResult(before, id);
    const nodeAfter = findNodeResult(after, id);
    assert.equal(
      Number((nodeBefore.inputDbm - nodeAfter.inputDbm).toFixed(2)), delta,
      id + " should move by exactly the upstream through-loss change",
    );
  }

  // The local tap at A improves by the same reasoning, in the other direction.
  assert.equal(
    Number((findNodeResult(after, "a").tapOutputDbm - findNodeResult(before, "a").tapOutputDbm).toFixed(2)),
    Number((10.5 - 4.5).toFixed(2)),
  );

  // downstreamNodes never includes the node itself.
  assert.deepEqual(downstreamNodes(after, "a").map((node) => node.id), ["b", "c", "end"]);
});

/* ------------------------------------------------------------------ *
 * 8. Recommendation solver preserves downstream limits
 * ------------------------------------------------------------------ */

test("recommendation solver preserves downstream limits and prefers the least aggressive change", () => {
  // A is FAIL at -22.60 dBm against a -22 dBm minimum; B, C and the end of the
  // leg are all comfortably PASS and must stay that way.
  const leg = longDropLeg({ limits: { receiverMinDbm: -22, receiverMaxDbm: -5, engineeringReserveDb: 1 } });
  const baseline = calculateLeg(leg);
  assert.equal(findNodeResult(baseline, "a").status, EBC_STATUS.FAIL);
  assert.equal(findNodeResult(baseline, "a").tapDeliveredDbm, -22.6);
  for (const id of ["b", "c", "end"]){
    assert.equal(findNodeResult(baseline, id).status, EBC_STATUS.PASS);
  }

  const recommendation = recommendPcot(leg, "a");
  assert.equal(recommendation.outcome, EBC_RECOMMENDATION_OUTCOME.CHANGE_RECOMMENDED);
  assert.equal(recommendation.currentPcot, "90/10");

  // It must not simply grab the hardest tap available.
  assert.notEqual(recommendation.recommendedPcot, "60/40");
  assert.equal(recommendation.recommendedPcot, "85/15");
  assert.equal(recommendation.tapImprovementDb, 2);
  assert.equal(recommendation.downstreamPenaltyDb, -0.3);

  // The winner is the least aggressive feasible candidate.
  const feasible = recommendation.candidates.filter((candidate) => candidate.feasible);
  assert.ok(feasible.length > 0);
  const leastAggressive = feasible.reduce((best, candidate) => (candidate.aggressiveness < best.aggressiveness ? candidate : best));
  assert.equal(recommendation.recommendedPcot, leastAggressive.ratio);

  // 60/40 gives the strongest tap of all and is still not chosen.
  const strongest = recommendation.candidates.find((candidate) => candidate.ratio === "60/40");
  assert.ok(strongest.localMarginDb > feasible.find((c) => c.ratio === "85/15").localMarginDb);

  // And every downstream location still holds after the recommendation.
  const applied = calculateLeg(leg, { ratioOverrides: { a: recommendation.recommendedPcot } });
  for (const node of downstreamNodes(applied, "a")){
    assert.notEqual(node.status, EBC_STATUS.FAIL, node.label + " must not fail after the recommendation");
  }
  assert.equal(findNodeResult(applied, "a").status, EBC_STATUS.PASS);
});

test("solver leaves a healthy PCOT alone instead of chasing a stronger tap", () => {
  const recommendation = recommendPcot(cascadeLeg(), "a");
  assert.equal(recommendation.outcome, EBC_RECOMMENDATION_OUTCOME.NO_CHANGE_REQUIRED);
  assert.equal(recommendation.recommendedPcot, "90/10");
  assert.equal(recommendation.changeRequired, false);
});

/* ------------------------------------------------------------------ *
 * 9. Rejects a ratio that fixes the local tap but breaks downstream
 * ------------------------------------------------------------------ */

test("solver rejects a ratio that fixes the local tap but causes a downstream failure", () => {
  // The end of the leg sits 1.75 dB above the limit, so the 1.9 dB of extra
  // through loss a 60/40 at A would cost pushes it under. A hard tap at A
  // still looks excellent locally.
  const leg = longDropLeg({ endDropDb: 10, limits: { receiverMinDbm: -22, receiverMaxDbm: -5, engineeringReserveDb: 0 } });
  const baseline = calculateLeg(leg);
  assert.equal(findNodeResult(baseline, "a").status, EBC_STATUS.FAIL);
  assert.equal(findNodeResult(baseline, "end").status, EBC_STATUS.PASS);
  assert.equal(findNodeResult(baseline, "end").marginDb, 1.75);

  // Prove the aggressive candidate really would fix A locally...
  const aggressive = calculateLeg(leg, { ratioOverrides: { a: "60/40" } });
  assert.equal(findNodeResult(aggressive, "a").status, EBC_STATUS.PASS);
  // ...while breaking the end of the leg.
  assert.equal(findNodeResult(aggressive, "end").status, EBC_STATUS.FAIL);

  // The what-if view must show it as locally attractive but not permitted.
  const comparison = whatIf(leg, "a", ["60/40"]);
  const candidate = comparison.candidates[0];
  assert.equal(candidate.localStatus, EBC_STATUS.PASS);
  assert.equal(candidate.allDownstreamWithinLimits, false);
  assert.equal(candidate.feasible, false);

  // And the solver must never return it.
  const recommendation = recommendPcot(leg, "a");
  assert.notEqual(recommendation.recommendedPcot, "60/40");
  assert.equal(recommendation.recommendedPcot, "85/15");

  // The rejection is attributed to the location that would have been sacrificed.
  assert.deepEqual(candidate.downstreamIssues.map((issue) => issue.nodeId), ["end"]);
});

/* ------------------------------------------------------------------ *
 * 10. No-safe-ratio condition
 * ------------------------------------------------------------------ */

test("no safe ratio reports NO SAFE PCOT CHANGE and names the limiting location", () => {
  // The end of the leg now has only 0.05 dB of margin, so even the gentlest
  // ratio that rescues A takes the end of the leg under. Nothing is safe.
  const leg = longDropLeg({ endDropDb: 11.7, limits: { receiverMinDbm: -22, receiverMaxDbm: -5, engineeringReserveDb: 0 } });
  const baseline = calculateLeg(leg);
  assert.equal(findNodeResult(baseline, "a").status, EBC_STATUS.FAIL);
  assert.equal(findNodeResult(baseline, "end").marginDb, 0.05);

  const recommendation = recommendPcot(leg, "a");
  assert.equal(recommendation.outcome, EBC_RECOMMENDATION_OUTCOME.NO_SAFE_PCOT_CHANGE);
  assert.equal(recommendation.recommendedPcot, null);
  assert.match(recommendation.reason, /NO SAFE PCOT CHANGE/);
  assert.ok(recommendation.limitingLocation, "a limiting downstream location must be identified");
  assert.equal(recommendation.limitingLocation.nodeId, "end");
  assert.match(recommendation.reason, /Terminal/);
  assert.equal(recommendation.candidates.every((candidate) => candidate.feasible === false), true);

  // Candidates that would have rescued the local tap are still shown, so the
  // technician can see the trade that was refused rather than a bare refusal.
  const rescuers = recommendation.candidates.filter((candidate) => candidate.localStatus === EBC_STATUS.PASS);
  assert.ok(rescuers.length > 0);
  assert.ok(rescuers.every((candidate) => candidate.allDownstreamWithinLimits === false));
});

/* ------------------------------------------------------------------ *
 * 11. Engineering margin
 * ------------------------------------------------------------------ */

test("engineering margin is the plain difference and classifies against the reserve", () => {
  // Tap delivered at A = -19.66 dBm on the single fixture.
  const pass = calculateLeg(singlePcotLeg({ limits: { receiverMinDbm: -28, engineeringReserveDb: 3 } }));
  const passNode = findNodeResult(pass, "pcot1");
  assert.equal(passNode.marginDb, Number((-19.66 - -28).toFixed(2)));
  assert.equal(passNode.status, EBC_STATUS.PASS);

  // Clears the minimum but not the reserve.
  const marginal = calculateLeg(singlePcotLeg({ limits: { receiverMinDbm: -21, engineeringReserveDb: 3 } }));
  assert.equal(findNodeResult(marginal, "pcot1").status, EBC_STATUS.MARGINAL);

  // Below the minimum outright.
  const fail = calculateLeg(singlePcotLeg({ limits: { receiverMinDbm: -18, engineeringReserveDb: 3 } }));
  const failNode = findNodeResult(fail, "pcot1");
  assert.equal(failNode.status, EBC_STATUS.FAIL);
  assert.equal(failNode.marginDb < 0, true);

  // Overload is a failure too, not a very large pass.
  const hot = calculateLeg(singlePcotLeg({ limits: { receiverMinDbm: -28, receiverMaxDbm: -25, engineeringReserveDb: 0 } }));
  const hotNode = findNodeResult(hot, "pcot1");
  assert.equal(hotNode.status, EBC_STATUS.FAIL);
  assert.equal(hotNode.statusCode, "RECEIVER_OVERLOAD");

  // Without limits there is no margin, and the engine says so rather than guessing.
  const noLimits = calculateLeg(singlePcotLeg({ limits: {} }));
  assert.equal(findNodeResult(noLimits, "pcot1").marginDb, null);
  assert.equal(noLimits.ok, false);
  assert.match(noLimits.validation.missingSummary.join(" "), /minimum required receive power/);
});

/* ------------------------------------------------------------------ *
 * 12. Measured versus predicted
 * ------------------------------------------------------------------ */

test("measured versus predicted reports the difference and flags an excessive tap loss", () => {
  const leg = singlePcotLeg();
  leg.nodes[0].measured = { inputDbm: -9.16, throughDbm: -9.86, tapDbm: -23.0, wavelengthNm: 1550 };

  const result = calculateLeg(leg, { mode: "field" });
  const comparison = compareMeasuredToPredicted(findNodeResult(result, "pcot1"));

  const byName = Object.fromEntries(comparison.rows.map((row) => [row.measurement, row]));
  assert.equal(byName.Input.predictedDbm, -9.16);
  assert.equal(byName.Input.actualDbm, -9.16);
  assert.equal(byName.Input.differenceDb, 0);
  assert.equal(byName.Through.differenceDb, 0);
  // Tap measured 3.34 dB below prediction.
  assert.equal(byName.Tap.differenceDb, Number((-23.0 - -19.66).toFixed(2)));
  assert.equal(byName.Tap.flag, "below_prediction");

  const codes = comparison.indicators.map((item) => item.code);
  assert.ok(codes.includes("EXCESSIVE_TAP_LOSS"), "an excessive tap loss should be indicated");
});

test("measured versus predicted detects a reversed PCOT and a physically impossible reading", () => {
  const leg = singlePcotLeg();
  // Through and tap swapped: through loses ~10.5 dB and tap loses ~0.7 dB.
  leg.nodes[0].measured = { inputDbm: -9.16, throughDbm: -19.66, tapDbm: -9.86, wavelengthNm: 1550 };
  const reversed = compareMeasuredToPredicted(findNodeResult(calculateLeg(leg, { mode: "field" }), "pcot1"));
  assert.ok(reversed.indicators.some((item) => item.code === "PROBABLE_REVERSED_PCOT"));

  // A tap above the input cannot happen in passive plant.
  const impossibleLeg = singlePcotLeg();
  impossibleLeg.nodes[0].measured = { inputDbm: -20, tapDbm: -10, wavelengthNm: 1550 };
  const impossible = compareMeasuredToPredicted(findNodeResult(calculateLeg(impossibleLeg, { mode: "field" }), "pcot1"));
  const flagged = impossible.indicators.find((item) => item.code === "TAP_EXCEEDS_INPUT");
  assert.ok(flagged);
  assert.equal(flagged.confidence, "DEMONSTRATED");
});

test("a tap loss that fits a different ratio is reported as a probable wrong PCOT", () => {
  const leg = singlePcotLeg();
  // Measured tap loss of 4.5 dB is the 60/40 figure, not the recorded 90/10.
  leg.nodes[0].measured = { inputDbm: -9.16, throughDbm: -11.76, tapDbm: -13.66, wavelengthNm: 1550 };
  const comparison = compareMeasuredToPredicted(findNodeResult(calculateLeg(leg, { mode: "field" }), "pcot1"));
  const indicator = comparison.indicators.find((item) => item.code === "PROBABLE_WRONG_PCOT");
  assert.ok(indicator, "the mismatch should surface as a probable wrong PCOT");
  assert.equal(indicator.evidence.bestFitRatio, "60/40");
  assert.equal(indicator.evidence.recordedRatio, "90/10");
});

/* ------------------------------------------------------------------ *
 * 13. Missing / unverified PCOT specification handling
 * ------------------------------------------------------------------ */

test("an unspecified ratio blocks the calculation and says exactly what is missing", () => {
  // 50/50 has no loss values anywhere in this repository.
  assert.ok(unspecifiedRatios().includes("50/50"));

  const leg = singlePcotLeg();
  leg.nodes[0].installedRatio = "50/50";
  const result = calculateLeg(leg);

  assert.equal(result.ok, false);
  assert.equal(result.confidence, "INSUFFICIENT");
  const node = findNodeResult(result, "pcot1");
  assert.equal(node.throughOutputDbm, null);
  assert.equal(node.tapOutputDbm, null);
  assert.equal(node.statusCode, "MISSING_SPECIFICATION");
  assert.match(result.validation.missingSummary.join(" "), /no insertion-loss specification is configured for 50\/50/);

  // The solver refuses to recommend rather than producing a confident answer.
  const recommendation = recommendPcot(leg, "pcot1");
  assert.equal(recommendation.outcome, EBC_RECOMMENDATION_OUTCOME.INSUFFICIENT_DATA);
  assert.equal(recommendation.recommendedPcot, null);
  assert.equal(recommendation.confidence, "INSUFFICIENT");
});

test("seeded specifications are usable but reported as UNVERIFIED until configured", () => {
  assert.deepEqual(usableRatios(), ["90/10", "85/15", "80/20", "70/30", "60/40"]);
  assert.equal(DEFAULT_PCOT_SPECS["90/10"].verified, false);
  assert.equal(DEFAULT_PCOT_SPECS["90/10"].status, "UNVERIFIED");

  const result = calculateLeg(singlePcotLeg());
  assert.equal(result.specsVerified, false);
  assert.deepEqual(result.unverifiedRatios, ["90/10"]);
  assert.ok(result.validation.warnings.some((item) => item.code === "UNVERIFIED_PCOT_SPECIFICATION"));

  // A partial configuration cannot promote itself to verified.
  const partial = configurePcotSpec(DEFAULT_PCOT_SPECS, "90/10", { nominalThroughLossDb: 0.8, verified: true });
  assert.equal(partial["90/10"].verified, false);
  assert.equal(partial["90/10"].status, "UNVERIFIED");

  // A complete manufacturer record can.
  const configured = configurePcotSpec(DEFAULT_PCOT_SPECS, "50/50", {
    nominalThroughLossDb: 3.4, nominalTapLossDb: 3.4,
    maxThroughInsertionLossDb: 4.0, maxTapInsertionLossDb: 4.0,
    manufacturer: "Example Optical", model: "PCOT-5050", wavelengthNm: 1550,
    reference: "Fixture data sheet", verified: true,
  });
  assert.equal(configured["50/50"].verified, true);
  assert.equal(configured["50/50"].status, "VERIFIED");
  assert.ok(usableRatios(configured).includes("50/50"));

  // Configuring returns a new set; the shipped defaults are untouched.
  assert.equal(DEFAULT_PCOT_SPECS["50/50"].nominalTapLossDb, null);
});

test("a worst-case budget refuses to fall back to typical values", () => {
  const result = calculateLeg(singlePcotLeg(), { lossBasis: "max" });
  assert.equal(result.ok, false);
  assert.match(result.validation.missingSummary.join(" "), /worst-case insertion loss is not configured/);
});

/* ------------------------------------------------------------------ *
 * 14. No mutation of original data during What-If
 * ------------------------------------------------------------------ */

test("what-if analysis never mutates the leg, its ratios or its field measurements", () => {
  const leg = cascadeLeg();
  leg.nodes[0].measured = { inputDbm: -6.6, throughDbm: -7.3, tapDbm: -17.1, wavelengthNm: 1550, notes: "original reading" };
  const snapshot = JSON.stringify(leg);

  const comparison = whatIf(leg, "a", ["85/15", "80/20", "70/30"]);
  assert.equal(comparison.candidates.length, 3);
  recommendPcot(leg, "a");
  calculateLeg(leg, { ratioOverrides: { a: "60/40" } });

  assert.equal(JSON.stringify(leg), snapshot, "the source leg must be byte-identical after analysis");
  assert.equal(leg.nodes[0].designedRatio, "90/10");
  assert.equal(leg.nodes[0].installedRatio, "90/10");
  assert.equal(leg.nodes[0].measured.tapDbm, -17.1);
  assert.equal(leg.nodes[0].measured.notes, "original reading");

  // The projection is separate data and is labelled as such.
  assert.equal(comparison.current.ratio, "90/10");
  assert.equal(comparison.provenance, "CALCULATED");
  assert.match(comparison.note, /unchanged until the change is explicitly accepted/);
  assert.equal(recommendPcot(leg, "a").provenance, "RECOMMENDED");
});

/* ------------------------------------------------------------------ *
 * Validation of impossible and suspicious inputs
 * ------------------------------------------------------------------ */

test("impossible and suspicious inputs are rejected with a specific message", () => {
  const gain = singlePcotLeg();
  gain.nodes[0].span.spliceLossDb = -0.5;
  assert.match(calculateLeg(gain).validation.missingSummary.join(" "), /Passive plant cannot add power/);

  const negativeDistance = singlePcotLeg();
  negativeDistance.nodes[0].span.distance = -2;
  assert.match(calculateLeg(negativeDistance).validation.missingSummary.join(" "), /Distance cannot be less than zero/);

  const badRatio = singlePcotLeg();
  badRatio.nodes[0].installedRatio = "90/20";
  assert.match(calculateLeg(badRatio).validation.missingSummary.join(" "), /not 100%/);

  const noLaunch = singlePcotLeg({ launch: {} });
  assert.match(calculateLeg(noLaunch).validation.missingSummary.join(" "), /Upstream launch power is missing/);

  const wavelengthMismatch = singlePcotLeg({ wavelengthNm: 1310 });
  assert.ok(calculateLeg(wavelengthMismatch).validation.warnings.some((item) => item.code === "WAVELENGTH_SPEC_MISMATCH"));

  const designedMismatch = singlePcotLeg();
  designedMismatch.nodes[0].installedRatio = "70/30";
  const mismatchResult = calculateLeg(designedMismatch);
  assert.ok(mismatchResult.validation.warnings.some((item) => item.code === "DESIGNED_INSTALLED_RATIO_MISMATCH"));
  // The installed device is what is budgeted, not the design intent.
  assert.equal(findNodeResult(mismatchResult, "pcot1").ratioUsed, "70/30");
  assert.equal(findNodeResult(mismatchResult, "pcot1").ratioSource, "INSTALLED");
});

/* ------------------------------------------------------------------ *
 * Audit trace
 * ------------------------------------------------------------------ */

test("every result carries an auditable trace of its own loss components", () => {
  const result = calculateLeg(singlePcotLeg());
  const node = findNodeResult(result, "pcot1");
  const text = formatTrace(node.trace);

  assert.match(text, /Launch \/ upstream power/);
  assert.match(text, /Fiber loss \(1\.24 km x 0\.25 dB\/km\)/);
  assert.match(text, /Splice loss \(2 x 0\.1 dB\)/);
  assert.match(text, /Connector loss \(1 x 0\.25 dB\)/);
  assert.match(text, /PCOT 2058 input\s+-9\.16 dBm/);
  assert.match(text, /Through output.*-9\.86 dBm/);
  assert.match(text, /Tap output\s+-19\.66 dBm/);
  assert.match(text, /UNVERIFIED/);

  // The components survive as data, not only as rendered text.
  assert.equal(node.span.fiberLossDb.toFixed(2), "0.31");
  assert.equal(node.span.spliceLossDb.toFixed(2), "0.20");
  assert.equal(node.span.connectorLossDb.toFixed(2), "0.25");
  assert.equal(node.throughInsertionLossDb, 0.7);
  assert.equal(node.tapInsertionLossDb, 10.5);
});

/* ------------------------------------------------------------------ *
 * Node 54 topology is derived, not invented
 * ------------------------------------------------------------------ */

test("Node 54 legs are derived from the documented schematic segments", () => {
  // S4 as documented: breakout at CP13817 then the S4 downstream trace.
  assert.deepEqual(deriveLegPath("S4"), ["np2015", "cp13817", "np2058", "np2060", "np2062", "np1715"]);

  const s4 = buildNode54Leg("S4");
  assert.deepEqual(s4.nodes.map((node) => node.np), ["2058", "2060", "2062", "1715"]);
  // Designed ratios come from the production record via NODE54_STOPS.
  assert.deepEqual(s4.nodes.map((node) => node.designedRatio), ["90/10", "85/15", "80/20", "70/30"]);

  // A sub-branch does not inherit a sibling sub-branch.
  assert.equal(deriveLegPath("S6:T3").includes("np1697"), true);
  assert.equal(deriveLegPath("S6:T3").includes("cp13817"), false);

  const legIds = buildNode54Legs().map((leg) => leg.legId);
  assert.deepEqual(legIds, ["S3", "S4", "S5", "S8"]);
});

test("a derived Node 54 leg states what engineering data it is missing", () => {
  const s4 = buildNode54Leg("S4");

  // Nothing is invented: no launch power, no attenuation, no limits.
  assert.equal(s4.launch.powerDbm, null);
  assert.equal(s4.limits.receiverMinDbm, null);
  assert.equal(s4.fiber.attenuationDbPerKm, null);

  // Span footage DOES come from the TDS export, in feet, and says so.
  assert.equal(s4.nodes[0].span.distance, 437);
  assert.equal(s4.nodes[0].span.distanceUnit, "ft");
  assert.equal(s4.nodes[0].span.distanceSource, "TDS_CABLE_PLACEMENT_FOOTAGE");
  // Splice and connector counts are still absent in both sources.
  assert.equal(s4.nodes[0].span.spliceCount, null);
  assert.equal(s4.nodes[0].span.connectorCount, null);

  // An installed ratio is a field observation and is never pre-filled.
  assert.equal(s4.nodes[0].installedRatio, null);
  assert.equal(s4.nodes[0].designedRatio, "90/10");
  assert.equal(s4.nodes[0].designedRatioSource, "TDS_PROJECT_EXPORT");
  assert.equal(s4.nodes[0].partNumber, "HxFO(1x4)PCOT(90/10)MO");
  assert.equal(s4.nodes[0].splitterRatio, 4);

  // Historical readings are carried, but not as input/through/tap values.
  assert.equal(s4.nodes[0].measured, null);
  assert.deepEqual(s4.nodes[0].historical.values, [-39.34, -22.19]);
  assert.match(s4.nodes[0].historical.note, /not confirmed/);

  assert.match(s4.dataGaps.join(" "), /not measured sheath length/);
  assert.match(s4.dataGaps.join(" "), /attenuation coefficient/);
  assert.match(s4.dataGaps.join(" "), /insertion loss is absent from the TDS export/);
  assert.match(s4.dataGaps.join(" "), /Launch power/);
  assert.match(s4.dataGaps.join(" "), /Engineering limits/);

  // The upstream splitter and breakout are documented but not budgeted at 0 dB.
  assert.deepEqual(s4.upstreamPath.map((stop) => stop.np), ["2015", "1702"]);

  // As shipped, the leg cannot produce a confident answer, and says why.
  const result = calculateLeg(s4);
  assert.equal(result.ok, false);
  assert.match(result.validation.missingSummary.join(" "), /Upstream launch power is missing/);
  assert.match(result.validation.missingSummary.join(" "), /minimum required receive power/);
});

test("the TDS project export agrees with the app's own derived cascade", () => {
  // The TDS Splitter Path position (L1..L5) is the design of record. It must
  // match what deriveLegPath() works out from NODE54_SCHEMATIC_SEGMENTS; if the
  // two ever diverge, one of the sources has changed and this fails loudly.
  for (const [branch, leg] of Object.entries(NODE54_TDS_LEGS)){
    const tdsOrder = leg.nodes.map((node) => node.np);
    const derived = buildNode54Leg(branch).nodes.map((node) => node.np);
    assert.deepEqual(derived, tdsOrder, branch + " cascade must match the TDS Splitter Path order");
    // Positions are strictly sequential, so no location is missing from either.
    assert.deepEqual(leg.nodes.map((node) => node.position), leg.nodes.map((_, i) => "L" + (i + 1)));
  }

  assert.deepEqual(NODE54_TDS_LEGS.S4.nodes.map((node) => node.ratio), ["90/10", "85/15", "80/20", "70/30"]);
  assert.deepEqual(NODE54_TDS_LEGS.S4.nodes.map((node) => node.spanFeetFromPrevious), [437, 240, 160, 191]);

  // TDS records NP2019 as an 85/15 PCOT. The imported production code carried
  // no ratio for it at all, so this is new engineering data, not a conflict.
  const s8 = buildNode54Leg("S8");
  const np2019 = s8.nodes.find((node) => node.np === "2019");
  assert.equal(np2019.designedRatio, "85/15");
  assert.equal(np2019.importedProductionCodeRatio, null);
  assert.equal(np2019.type, "pcot");

  // The export carries no optical loss anywhere, so specs stay UNVERIFIED.
  assert.equal(NODE54_TDS_SOURCE.containsInsertionLoss, false);
  assert.equal(DEFAULT_PCOT_SPECS["90/10"].verified, false);
  // But the part number to request a data sheet for is now known.
  assert.equal(DEFAULT_PCOT_SPECS["90/10"].model, "HxFO(1x4)PCOT(90/10)MO");
  assert.equal(DEFAULT_PCOT_SPECS["90/10"].manufacturer, "");
  // A ratio TDS never specified has no part number and no loss values.
  assert.equal(DEFAULT_PCOT_SPECS["50/50"].model, "");
});

test("a Node 54 leg calculates once the missing engineering inputs are supplied", () => {
  const leg = buildNode54Leg("S4");
  leg.launch.powerDbm = -8.4;
  leg.limits = { receiverMinDbm: -28, receiverMaxDbm: -5, engineeringReserveDb: 3 };
  leg.fiber = { attenuationDbPerKm: 0.25, distanceUnit: "km" };
  leg.nodes = leg.nodes.map((node) => ({ ...node, installedRatio: node.designedRatio, span: { ...node.span, distance: 0.5, distanceUnit: "km", spliceCount: 1, connectorCount: 2 } }));
  leg.defaults = { spliceLossDb: 0.1, connectorLossDb: 0.25 };

  const result = calculateLeg(leg);
  assert.equal(result.ok, true);
  assert.equal(result.nodes.length, 4);
  // 0.5 km x 0.25 + 1 x 0.10 + 2 x 0.25 = 0.725 dB of span into the first PCOT.
  assert.equal(result.nodes[0].inputDbm, -9.13);
  // Each downstream input is strictly weaker than the one before it.
  for (let index = 1; index < result.nodes.length; index += 1){
    assert.ok(result.nodes[index].inputDbm < result.nodes[index - 1].inputDbm);
  }
  assert.ok(result.weakest);
  assert.equal(result.confidence, "MEDIUM");
});
