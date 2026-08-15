import test from "node:test";
import assert from "node:assert/strict";
import { analyzeRootProject, buildRootFieldBrief, searchRootProject } from "../services/rootCommandCenter.mjs";

const sites = [
  { id: "a", name: "RuidosoNetworkPoint-1702", notes: "CP13817 P0002 F42", gps_lat: 33.3, gps_lng: -105.6, test_result_low: -20.71, units_allowed: 2, units_billed: 2 },
  { id: "b", name: "RuidosoNetworkPoint-2058", notes: "S4 F36", gps_lat: null, gps_lng: null, test_result_low: -39.34, units_allowed: 1, units_billed: 2 },
];

test("project analysis derives transparent exceptions without editing records", () => {
  const analysis = analyzeRootProject({
    sites,
    workLogs: [{ site_id: "b", completed_at: "2026-08-01T12:00:00Z", nearest_distance_m: 220 }],
    closeouts: [{ base_location_id: "b", submitted_at: "2026-08-01T12:10:00Z", checklist: { final_status: "Needs Return", photo_count: 0 } }],
  });
  assert.equal(analysis.metrics.total, 2);
  assert.equal(analysis.metrics.needsReturn, 1);
  assert.equal(analysis.metrics.opticalConcern, 1);
  assert.equal(analysis.metrics.missingGps, 1);
  assert.ok(analysis.issues.some((issue) => issue.siteId === "b" && issue.type === "billing_overage"));
});

test("project search includes identifiers, notes, codes, and exception evidence", () => {
  const analysis = analyzeRootProject({ sites, codes: [{ site_id: "a", code: "FBTEST" }] });
  assert.deepEqual(searchRootProject(analysis, "13817").map((record) => record.siteId), ["a"]);
  assert.deepEqual(searchRootProject(analysis, "F36").map((record) => record.siteId), ["b"]);
  assert.deepEqual(searchRootProject(analysis, "FBTEST").map((record) => record.siteId), ["a"]);
});

test("recorded closeout photo evidence avoids a false missing-photo exception", () => {
  const analysis = analyzeRootProject({
    sites: [{ id: "a", name: "P0001", gps_lat: 33, gps_lng: -105 }],
    closeouts: [{ base_location_id: "a", submitted_at: "2026-08-01T12:10:00Z", checklist: { final_status: "Complete", photo_count: 2 } }],
  });

  assert.equal(analysis.records[0].hasPhotoEvidence, true);
  assert.equal(analysis.metrics.missingPhotosAfterWork, 0);
  assert.equal(analysis.issues.some((issue) => issue.type === "closeout_missing_photo"), false);
});

test("field brief is grounded in computed metrics", () => {
  const analysis = analyzeRootProject({ sites });
  const brief = buildRootFieldBrief(analysis);
  assert.match(brief.headline, /0 of 2/);
  assert.ok(brief.priorityLocations.includes("RuidosoNetworkPoint-2058"));
});
