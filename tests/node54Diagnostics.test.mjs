import test from "node:test";
import assert from "node:assert/strict";
import { assessComponentPair, buildBranchStatuses, isNode54Project, NODE54_STATUS, NODE54_STOPS } from "../services/node54Diagnostics.mjs";

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

test("first implementation contains all required numbered stops", () => {
  assert.deepEqual(NODE54_STOPS.map((stop) => stop.np), ["1702", "2015", "1696", "1697", "2056", "2058", "12001", "2017"]);
});
