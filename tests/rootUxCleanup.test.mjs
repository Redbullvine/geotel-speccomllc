import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appSource = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const indexSource = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const stylesSource = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

test("ROOT identity remains centralized in the authoritative helper", () => {
  assert.match(appSource, /function isBreakGlassUser\(\)[\s\S]*?SpecCom\.helpers\.isRoot = function\(\)/);
  assert.equal((appSource.match(/support@fatanett\.com/g) || []).length, 1);
  assert.match(appSource, /function bypassesFieldDayWorkflow\(\)\{\s*return isEffectiveRootRole\(\);\s*\}/);
});

test("ROOT field-day UI renderers and indirect actions use the bypass", () => {
  for (const functionName of [
    "loadFieldDaySession",
    "startFieldDay",
    "startFieldDayEvent",
    "endFieldDayEvent",
    "finalizeFieldDayLocation",
    "endFieldDayLocation",
    "endFieldDay",
    "renderFieldDayControls",
    "renderFieldDayLocationControls",
    "renderFieldBreakLunchCard",
    "renderFieldDayEndCard",
    "recordFieldLocationPingFromGps",
    "uploadMapFieldVisitPhotos",
    "saveMapFieldWorkLog",
  ]) {
    const start = appSource.indexOf(`function ${functionName}`);
    assert.notEqual(start, -1, `${functionName} should exist`);
    const bodyStart = appSource.indexOf("{", start);
    const opening = appSource.slice(bodyStart + 1, bodyStart + 220);
    assert.match(opening, /bypassesFieldDayWorkflow\(\)/, `${functionName} should gate ROOT before field-day requirements`);
  }
});

test("ROOT receives the admin map panel and not the technician timekeeping view", () => {
  assert.match(appSource, /if \(viewId === "viewTechnician" && bypassesFieldDayWorkflow\(\)\) return false;/);
  assert.match(appSource, /if \(isRoot\)\{[\s\S]*?renderRootMapAdminControls\(\)[\s\S]*?return;/);
  assert.match(appSource, /ROOT Map Administration/);
  assert.match(appSource, /Master location search/);
  assert.match(appSource, /Create Location/);
  assert.match(appSource, /Import Locations/);
});

test("global header has one hamburger before one right-aligned SpecCom logo", () => {
  const nav = indexSource.match(/<nav id="main-navbar">([\s\S]*?)<\/nav>/)?.[1] || "";
  assert.equal((nav.match(/id="btnMenu"/g) || []).length, 1);
  assert.equal((nav.match(/class="nav-logo-img nav-logo-right"/g) || []).length, 1);
  assert.ok(nav.indexOf('id="btnMenu"') < nav.indexOf('class="nav-logo-img nav-logo-right"'));
  assert.match(indexSource, /#main-navbar\s*\{[\s\S]*?display:\s*flex;[\s\S]*?align-items:\s*center;/);
  assert.match(stylesSource, /\.nav-logo-right\s*\{\s*margin-left:\s*4px;\s*\}/);
  assert.match(stylesSource, /@media \(max-width:\s*480px\)[\s\S]*?#main-navbar \.nav-hamburger\s*\{[^}]*display:\s*flex !important;[^}]*\}[\s\S]*?#main-navbar \.nav-logo-right\s*\{[^}]*margin-left:\s*auto;/);
});
