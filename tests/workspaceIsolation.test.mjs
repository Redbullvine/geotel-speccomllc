import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appSource = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const indexSource = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const stylesSource = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

/**
 * Top-level workspace sections are flat siblings of `main.content`, so they are
 * the only <section> tags at that indentation. Slicing on that boundary gives
 * us each workspace's markup without needing a DOM.
 */
const SECTION_BOUNDARY = /^ {8}<section id="(view\w+)" class="view([^"]*)"[^>]*>\r?$/gm;

function sliceWorkspaceSections(){
  const boundaries = [...indexSource.matchAll(SECTION_BOUNDARY)];
  return boundaries.map((match, index) => ({
    id: match[1],
    extraClasses: match[2].trim(),
    markup: indexSource.slice(match.index, boundaries[index + 1]?.index ?? indexSource.length),
  }));
}

test("every workspace section is a flat sibling, and exactly one starts active", () => {
  const sections = sliceWorkspaceSections();
  assert.ok(sections.length >= 19, `expected the full workspace set, found ${sections.length}`);

  const ids = sections.map((section) => section.id);
  assert.equal(new Set(ids).size, ids.length, "workspace section ids must be unique");

  for (const expected of [
    "viewDashboard", "viewMap", "viewTechnician", "viewInvoices", "viewCatalog",
    "viewDispatch", "viewSupervisor", "viewAdmin", "viewRootCommandCenter", "viewOnboarding",
    "viewEbc",
  ]){
    assert.ok(ids.includes(expected), `${expected} should be a top-level workspace section`);
  }

  const active = sections.filter((section) => section.extraClasses.split(/\s+/).includes("active"));
  assert.deepEqual(active.map((section) => section.id), ["viewDashboard"],
    "only the Workspace Gateway may be pre-activated in markup");

  // No workspace may be nested inside another workspace.
  for (const section of sections){
    const nested = [...section.markup.matchAll(/<section id="(view\w+)" class="view/g)]
      .map((match) => match[1])
      .filter((id) => id !== section.id);
    assert.deepEqual(nested, [], `${section.id} must not contain another workspace section`);
  }
});

test("CSS force-hides every non-active workspace", () => {
  assert.match(
    stylesSource,
    /\.view:not\(\.active\)\s*\{\s*display:\s*none\s*!important;\s*\}/,
    "the single-workspace guard must stay in styles.css",
  );
  assert.match(stylesSource, /\.view\{display:none\}/);
  assert.match(stylesSource, /\.view\.active\{display:block\}/);
});

test("the signed-out app shell stays hidden behind the splash", () => {
  // Regression guard: `display: block !important` here beat the inline
  // display:none that showAuth() sets, leaving the whole shell laid out.
  const rule = stylesSource.match(/body:not\(\.map-mode\) \.app-shell \{([^}]*)\}/)?.[1] || "";
  assert.ok(rule, "the non-map-mode app-shell rule should still exist");
  assert.doesNotMatch(rule, /!important/,
    "app-shell display must not be !important or it overrides showAuth()");
  assert.match(rule, /display:\s*block;/);
  assert.match(appSource, /\$\("viewApp"\)\.style\.display = show \? "none" : "";/);
});

test("each workspace owns its panels exclusively", () => {
  const sections = sliceWorkspaceSections();
  const owner = (id) => sections.find((section) => section.id === id);

  const exclusive = [
    ["viewRootCommandCenter", ["root-cc-section", "rootCommandCenterTitle"]],
    ["viewOnboarding", ["onboarding-shell"]],
    ["viewMap", ["redlineEditorBackdrop", "overageEditorBackdrop"]],
  ];

  for (const [sectionId, markers] of exclusive){
    const section = owner(sectionId);
    assert.ok(section, `${sectionId} should exist`);
    for (const marker of markers){
      assert.ok(section.markup.includes(marker), `${marker} should live inside ${sectionId}`);
      for (const other of sections){
        if (other.id === sectionId) continue;
        assert.ok(!other.markup.includes(marker),
          `${marker} leaked into ${other.id}; it belongs to ${sectionId} only`);
      }
    }
  }
});

test("every hash route resolves to exactly one workspace section", () => {
  const sectionIds = new Set(sliceWorkspaceSections().map((section) => section.id));
  const routed = [...appSource.matchAll(/return "(view\w+)";/g)]
    .map((match) => match[1])
    .filter((id) => id.startsWith("view"));
  for (const viewId of new Set(routed)){
    if (!sectionIds.has(viewId)) continue;
    const openings = (indexSource.match(new RegExp(`<section id="${viewId}" class="view`, "g")) || []).length;
    assert.equal(openings, 1, `${viewId} must be declared exactly once`);
  }
});

test("the Workspace Gateway stays reachable from the menu", () => {
  const menu = indexSource.match(/<div id="menuModal"[\s\S]*?<div class="menu-section">([\s\S]*?)<\/div>\s*<div class="menu-section">/)?.[1] || "";
  assert.ok(menu, "the menu Navigation section should exist");
  assert.match(menu, /id="btnMenuWorkspaceGateway"[\s\S]*?data-view="viewDashboard"/);
  assert.match(menu, /Workspace Gateway/);
  // the pre-existing entries must survive this stage
  assert.match(menu, /data-view="viewMap"/);
  assert.match(menu, /data-view="viewRootCommandCenter"/);
});

test("the Fiber Engineer owns the #ebc route and only that section", () => {
  // route registration, both directions
  assert.match(appSource, /routeToken === "ebc"[\s\S]{0,80}return "viewEbc";/);
  assert.match(appSource, /viewId === "viewEbc"\)\{\s*nextHash = "#ebc";/);

  const sections = sliceWorkspaceSections();
  const ebc = sections.find((section) => section.id === "viewEbc");
  assert.ok(ebc, "viewEbc should be a top-level workspace section");
  assert.ok(ebc.markup.includes("ebcRoot"), "the Fiber Engineer renders into its own root");
  assert.ok(!ebc.extraClasses.split(/\s+/).includes("active"), "it must not be pre-activated");

  // the Fiber Engineer markup lives nowhere else
  for (const other of sections){
    if (other.id === "viewEbc") continue;
    assert.ok(!other.markup.includes("ebcRoot"), `ebcRoot leaked into ${other.id}`);
  }
  assert.equal((indexSource.match(/id="ebcRoot"/g) || []).length, 1);
});
