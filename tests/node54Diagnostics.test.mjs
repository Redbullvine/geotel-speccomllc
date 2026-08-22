import test from "node:test";
import assert from "node:assert/strict";
import { assessComponentPair, assessNode54Device, buildBranchStatuses, isNode54Project, NODE54_STATUS, NODE54_STOPS } from "../services/node54Diagnostics.mjs";

test("recognizes Ruidoso Revisit without relying only on UUID", () => {
  assert.equal(isNode54Project({ name: "  Ruidoso   Revisit " }), true);
  assert.equal(isNode54Project({ name: "Ruidoso_1635CA" }), false);
});

test("component assessment uses both absolute input and delta", () => {
  assert.equal(assessComponentPair(-20, -25).code, "isolated");
  assert.equal(assessComponentPair(-31, -36).code, "weak_upstream");
  assert.equal(assessComponentPair(-20, -20.8).code, "cleared");
  assert.equal(assessComponentPair(null, -20).code, "incomplete");
});

test("branch status changes only from current-session evidence", () => {
  const initial = buildBranchStatuses([]);
  assert.equal(initial.S3, NODE54_STATUS.UNTESTED);
  assert.equal(initial.S7, NODE54_STATUS.HISTORICAL_GOOD);
  const current = buildBranchStatuses([{ path: "S3", interpretation: { code: "cleared" } }]);
  assert.equal(current.S3, NODE54_STATUS.CLEARED);
});

test("trace retains the required core stops and adds downstream branch evidence points", () => {
  const points = NODE54_STOPS.map((stop) => stop.np);
  assert.deepEqual(points.slice(0, 8), ["1702", "2015", "1696", "1697", "2056", "2058", "12001", "2017"]);
  ["1713", "2066", "1708", "2067", "2060", "2062", "1715", "1706", "1699", "2054", "1704", "2103", "2019"].forEach((point) => assert.ok(points.includes(point)));
});

test("every Node 54 PCOT ratio matches the original 1/9-1/17 production record", () => {
  // Source: production_1_9_2026 - 1_17_2026.pdf, pp. 1-2,
  // NODE54_1635CA_02 records with HxFO(1X4)PCOT(ratio)MO.
  const expected = {
    "12001": "90/10", "1704": "60/40", "1706": "85/15", "1708": "70/30",
    "1713": "85/15", "1715": "70/30", "1699": "80/20", "2017": "90/10",
    "2054": "70/30", "2056": "90/10", "2058": "90/10", "2060": "85/15",
    "2062": "80/20", "2066": "80/20", "2067": "60/40", "2103": "90/10",
  };
  const actual = Object.fromEntries(NODE54_STOPS.filter((stop) => expected[stop.np]).map((stop) => [stop.np, stop.expectedRatio]));
  assert.deepEqual(actual, expected);
});

test("PCOT assessment distinguishes a ratio mismatch, upstream weakness, and normal estimated through loss", () => {
  assert.equal(assessNode54Device({ inputDbm: -18, throughDbm: -18.8, expectedRatio: "90/10", actualRatio: "80/20", direction: "confirmed" }).code, "ratio_mismatch");
  assert.equal(assessNode54Device({ inputDbm: -31, throughDbm: -31.5, expectedRatio: "90/10", direction: "confirmed" }).code, "weak_upstream");
  assert.equal(assessNode54Device({ inputDbm: -18, throughDbm: -18.6, expectedRatio: "90/10", actualRatio: "90/10", direction: "confirmed" }).status, "pass");
});
