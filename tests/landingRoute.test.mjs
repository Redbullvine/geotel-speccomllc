import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  LANDING_ROLE_TIER,
  LANDING_ROUTES,
  lastWorkspaceStorageKey,
  normalizeTradeKey,
  normalizeWorkspaceHash,
  resolveLandingRoute,
  resolveRoleTier,
  resolveTradeRoute,
} from "../services/landingRoute.mjs";

test("production role codes collapse onto the three landing tiers", () => {
  assert.equal(resolveRoleTier({ role: "ROOT" }), LANDING_ROLE_TIER.ROOT);
  for (const role of ["OWNER", "ADMIN", "OFFICE", "SUPPORT"]){
    assert.equal(resolveRoleTier({ role }), LANDING_ROLE_TIER.ADMIN, `${role} should be an admin tier`);
  }
  for (const role of ["TECHNICIAN", "SPLICER", "TDS", "SUB", "PRIME", "", null]){
    assert.equal(resolveRoleTier({ role }), LANDING_ROLE_TIER.MEMBER, `${role} should be a member tier`);
  }
  assert.equal(resolveRoleTier(null), LANDING_ROLE_TIER.MEMBER);
  assert.equal(resolveRoleTier("root"), LANDING_ROLE_TIER.ROOT);
});

test("root lands in the ROOT Command Center", () => {
  assert.equal(resolveLandingRoute({ role: "ROOT" }), "#root-command-center");
});

test("admin tiers land in the Administration workspace", () => {
  for (const role of ["OWNER", "ADMIN", "OFFICE", "SUPPORT"]){
    assert.equal(resolveLandingRoute({ role }), "#admin", `${role} should land on #admin`);
  }
});

test("members land in their trade workspace", () => {
  assert.equal(resolveLandingRoute({ role: "SPLICER" }), "#map");
  assert.equal(resolveLandingRoute({ role: "TECHNICIAN" }), "#technician");
  assert.equal(resolveLandingRoute({ role: "WAREHOUSE" }), "#warehouse");
  assert.equal(resolveLandingRoute({ role: "DISPATCH" }), "#dispatch");
});

test("an explicit trade field outranks the role code", () => {
  assert.equal(resolveLandingRoute({ role: "TECHNICIAN", trade: "OSP Splicer" }), "#map");
  assert.equal(resolveTradeRoute({ role: "SPLICER", default_workspace: "warehouse" }), "#warehouse");
  assert.equal(normalizeTradeKey("Drop-Crew"), "drop_crew");
  assert.equal(normalizeTradeKey("nonsense"), "");
});

test("members with no trade fall back to last-used, then the Gateway", () => {
  assert.equal(resolveLandingRoute({ role: "TDS" }, { lastWorkspace: "#warehouse" }), "#warehouse");
  assert.equal(resolveLandingRoute({ role: "TDS" }), LANDING_ROUTES.gateway);
  assert.equal(resolveLandingRoute(null), "#home");
  // a trade always beats the stale last-used workspace
  assert.equal(resolveLandingRoute({ role: "SPLICER" }, { lastWorkspace: "#admin" }), "#map");
});

test("landing never returns a route the app says is disallowed", () => {
  const denyRoot = (hash) => hash !== "#root-command-center";
  assert.equal(resolveLandingRoute({ role: "ROOT" }, { isAllowedRoute: denyRoot }), "#home");

  const denyAdmin = (hash) => hash !== "#admin";
  assert.equal(
    resolveLandingRoute({ role: "ADMIN" }, { isAllowedRoute: denyAdmin, lastWorkspace: "#map" }),
    "#map",
  );

  // a disallowed last-used workspace is skipped rather than honoured
  const denyWarehouse = (hash) => hash !== "#warehouse";
  assert.equal(
    resolveLandingRoute({ role: "TDS" }, { isAllowedRoute: denyWarehouse, lastWorkspace: "#warehouse" }),
    "#home",
  );

  // even a total denial still yields the Gateway rather than an empty hash
  assert.equal(resolveLandingRoute({ role: "ROOT" }, { isAllowedRoute: () => false }), "#home");
});

test("only real workspace hashes survive normalization", () => {
  assert.equal(normalizeWorkspaceHash("#Billing"), "#billing");
  assert.equal(normalizeWorkspaceHash("admin/onboarding"), "#admin/onboarding");
  assert.equal(normalizeWorkspaceHash("#office?invoice=KS-1"), "#office");
  assert.equal(normalizeWorkspaceHash("#login"), "");
  assert.equal(normalizeWorkspaceHash("#access_token=abc&type=recovery"), "");
  assert.equal(normalizeWorkspaceHash(""), "");
  assert.equal(normalizeWorkspaceHash(null), "");
});

test("last-workspace storage is namespaced per user", () => {
  assert.equal(lastWorkspaceStorageKey("abc-123"), "speccom.lastWorkspace.abc-123");
  assert.equal(lastWorkspaceStorageKey(""), "");
  assert.equal(lastWorkspaceStorageKey(null), "");
});

/* -- app.js wiring -------------------------------------------------------- */

const appSource = readFileSync(new URL("../app.js", import.meta.url), "utf8");

test("app.js resolves the landing route on login and session restore", () => {
  assert.match(appSource, /from "\.\/services\/landingRoute\.mjs"/);

  // Both sign-in and session-restore funnel through postLoginBootstrap.
  assert.match(appSource, /_postLoginBootstrapDone = true;[\s\S]{0,400}getDefaultView\(\{ allowHash: true \}\)/);

  // getDefaultView consults the landing route before the old viewMap default.
  const body = appSource.match(/function getDefaultView\(\{ allowHash = false \} = \{\}\)\{([\s\S]*?)\n\}/)?.[1] || "";
  assert.ok(body, "getDefaultView should still exist");
  assert.ok(body.indexOf("parseViewFromHash()") < body.indexOf("getLandingView()"),
    "a deep link must be honoured before the role landing route");
  assert.ok(body.indexOf("getLandingView()") < body.indexOf('isViewAllowed("viewMap")'),
    "the role landing route must outrank the legacy viewMap default");
});

test("landing candidates are filtered through isViewAllowed", () => {
  assert.match(appSource, /function isLandingRouteAllowed\(hashValue\)\{\s*const viewId = parseViewFromHash\(hashValue\);\s*return Boolean\(viewId && isViewAllowed\(viewId\)\);/);
  assert.match(appSource, /resolveLandingRoute\(state\.profile, \{[\s\S]*?isAllowedRoute: isLandingRouteAllowed,/);
});

test("the active workspace is persisted per user", () => {
  assert.match(appSource, /lastWorkspaceStorageKey\(getLandingUserId\(\)\)/);
  assert.match(appSource, /window\.localStorage\.setItem\(storageKey, normalized\)/);
  // recorded both when the app drives the view and when the hash changes underneath it
  assert.match(appSource, /syncHashForView\(viewId\);\s*\}\s*rememberLastWorkspaceHash\(\);/);
  assert.match(appSource, /storePostAuthRedirect\(\);\s*\}\s*rememberLastWorkspaceHash\(\);/);
});

test("a #billing deep link is not rewritten to #office", () => {
  assert.match(appSource, /currentHash\.startsWith\("#billing"\)\)\{\s*nextHash = "#billing";/);
});

test("signing out re-arms the landing resolution for the next login", () => {
  assert.match(appSource, /function applySignedOutUi\(reason = "unknown"\)\{\s*state\.authResolved = true;\s*_postLoginBootstrapDone = false;/);
});
