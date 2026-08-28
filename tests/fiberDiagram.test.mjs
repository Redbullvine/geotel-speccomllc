import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  CableStringError,
  FIBER_ASSIGNMENT_KIND,
  expandRange,
  parseCableString,
} from "../services/fiberDiagram/cableString.mjs";
import {
  DEFAULT_CABLE_BUILD,
  FiberColorError,
  TIA598_COLORS,
  describeCableBuild,
  fiberColor,
  inferTubeSize,
} from "../services/fiberDiagram/fiberColors.mjs";
import { renderSpliceDiagram, SpliceDiagramError } from "../services/fiberDiagram/spliceDiagram.mjs";
import {
  buildManualPole,
  buildSplicePoles,
  fiberCountFromLaborUnit,
  resolveDirection,
  splittersFromDevices,
} from "../services/fiberDiagram/poleModel.mjs";

const appSource = readFileSync(new URL("../app.js", import.meta.url), "utf8");

/* -- connectivity string grammar ------------------------------------------ */

test("a real Node 54 cable string maps every fiber to its assignment", () => {
  const parsed = parseCableString(
    "XD:1-25;1635CA:P0002-3;XD:28-32;1635CA,P0004:S1-7;XD:40-43;1635CA,P0004,S8:T4;XD:45-48",
  );
  assert.equal(parsed.fiberCount, 48);
  assert.equal(parsed.assignments.length, 48);

  const at = (fiber) => parsed.assignments.find((a) => a.fiber === fiber);
  assert.equal(at(1).kind, FIBER_ASSIGNMENT_KIND.XD);
  assert.equal(at(26).label, "1635CA:P0002");
  assert.equal(at(27).label, "1635CA:P0003");
  assert.equal(at(26).kind, FIBER_ASSIGNMENT_KIND.EXPRESS);
  // S legs are splitter outputs and land on 33-39
  for (let fiber = 33; fiber <= 39; fiber += 1){
    assert.equal(at(fiber).kind, FIBER_ASSIGNMENT_KIND.SPLIT_LEG);
    assert.equal(at(fiber).label, `1635CA,P0004:S${fiber - 32}`);
    assert.deepEqual([...at(fiber).path], ["P0004"]);
  }
  // a T leg is a drop-feeding leg
  assert.equal(at(44).kind, FIBER_ASSIGNMENT_KIND.DROP);
  assert.equal(at(44).label, "1635CA,P0004,S8:T4");
  assert.deepEqual([...at(44).path], ["P0004", "S8"]);
});

test("range tails are right-aligned into the head width", () => {
  assert.deepEqual(expandRange("P0002-3"), ["P0002", "P0003"]);
  assert.deepEqual(expandRange("P0002-4"), ["P0002", "P0003", "P0004"]);
  assert.deepEqual(expandRange("0364-0365"), ["0364", "0365"]);
  assert.deepEqual(expandRange("S1-7"), ["S1", "S2", "S3", "S4", "S5", "S6", "S7"]);
  assert.deepEqual(expandRange("T4"), ["T4"]);
  assert.deepEqual(expandRange("1-3"), ["1", "2", "3"]);
});

test("identifiers with underscores and bare numeric circuits are accepted", () => {
  const parsed = parseCableString("XD:1-3;1635AA:0364-0365;XD:6-25;1635CA_BF:P0002-4;XD:29-48");
  assert.equal(parsed.fiberCount, 48);
  const at = (fiber) => parsed.assignments.find((a) => a.fiber === fiber);
  assert.equal(at(4).label, "1635AA:0364");
  assert.equal(at(4).kind, FIBER_ASSIGNMENT_KIND.EXPRESS);
  assert.equal(at(26).cableId, "1635CA_BF");
});

test("a string that does not start with XD begins at fiber 1", () => {
  const parsed = parseCableString("1635CA,P0003:S5");
  assert.equal(parsed.fiberCount, 1);
  assert.equal(parsed.assignments[0].fiber, 1);
  assert.equal(parsed.assignments[0].label, "1635CA,P0003:S5");
});

test("malformed strings are rejected with a precise reason, never guessed", () => {
  const cases = [
    ["", /Empty connectivity string/],
    ["XD1-25", /missing its ":" separator/],
    ["XD:1-25;;1635CA:P0002", /Empty segment at position 2/],
    ["XD:1-25;1635CA:P0002:S1", /more than one ":"/],
    ["XD:1-25;:P0002", /no cable identifier/],
    ["XD:1-25;1635CA:", /Empty fiber range/],
    ["XD:1-25;1635CA:PXXXX", /Malformed range token/],
    ["XD:1-25;1635CA:P0005-2", /Descending range/],
    ["XD:1-25;16 35CA:P0002", /Invalid identifier/],
  ];
  for (const [input, pattern] of cases){
    assert.throws(() => parseCableString(input), (error) => {
      assert.ok(error instanceof CableStringError, `${input} should raise CableStringError`);
      assert.match(error.message, pattern);
      return true;
    }, `expected ${input} to be rejected`);
  }
});

test("an XD range that disagrees with the running fiber count is rejected", () => {
  // P0002-3 consumes 26 and 27, so the next XD run must start at 28
  assert.throws(
    () => parseCableString("XD:1-25;1635CA:P0002-3;XD:30-32"),
    (error) => {
      assert.match(error.message, /starts at fiber 30 but the preceding segments end at fiber 27/);
      assert.equal(error.expectedStart, 28);
      assert.equal(error.declaredStart, 30);
      return true;
    },
  );
});

test("a declared cable count that disagrees with the string is rejected", () => {
  assert.throws(
    () => parseCableString("XD:1-24", { expectedFiberCount: 48 }),
    /accounts for 24 fibers but the cable is 48 count/,
  );
  assert.doesNotThrow(() => parseCableString("XD:1-48", { expectedFiberCount: 48 }));
});

/* -- TIA-598 colour model -------------------------------------------------- */

test("the TIA-598 sequence is the standard twelve in order", () => {
  assert.deepEqual(TIA598_COLORS.map((c) => c.name), [
    "Blue", "Orange", "Green", "Brown", "Slate", "White",
    "Red", "Black", "Yellow", "Violet", "Rose", "Aqua",
  ]);
});

test("a 48ct cable on 24F tubes is Blue 1-24 and Orange 25-48", () => {
  assert.deepEqual(DEFAULT_CABLE_BUILD, { fiberCount: 48, tubeSize: 24 });
  const tubes = describeCableBuild({ fiberCount: 48, tubeSize: 24 });
  assert.equal(tubes.length, 2);
  assert.deepEqual(tubes.map((t) => [t.tubeColor.name, t.firstFiber, t.lastFiber]), [
    ["Blue", 1, 24],
    ["Orange", 25, 48],
  ]);
});

test("the colour sequence repeats within each 24F tube", () => {
  const build = { tubeSize: 24 };
  assert.equal(fiberColor(1, build).color.name, "Blue");
  assert.equal(fiberColor(12, build).color.name, "Aqua");
  assert.equal(fiberColor(13, build).color.name, "Blue");   // second dozen restarts
  assert.equal(fiberColor(24, build).color.name, "Aqua");
  assert.equal(fiberColor(25, build).tubeColor.name, "Orange");
  assert.equal(fiberColor(25, build).color.name, "Blue");
  assert.equal(fiberColor(48, build).color.name, "Aqua");
  assert.equal(fiberColor(48, build).tube, 2);
});

test("a 12F tube build advances the tube colour every twelve fibers", () => {
  const build = { tubeSize: 12 };
  assert.equal(fiberColor(12, build).tubeColor.name, "Blue");
  assert.equal(fiberColor(13, build).tubeColor.name, "Orange");
  assert.equal(fiberColor(25, build).tubeColor.name, "Green");
  assert.equal(fiberColor(13, build).color.name, "Blue");
  assert.deepEqual(
    describeCableBuild({ fiberCount: 48, tubeSize: 12 }).map((t) => t.tubeColor.name),
    ["Blue", "Orange", "Green", "Brown"],
  );
});

test("tube size is inferred only for standard builds", () => {
  assert.equal(inferTubeSize(48), 24);
  assert.equal(inferTubeSize(144), 24);
  assert.equal(inferTubeSize(24), 12);
  assert.equal(inferTubeSize(12), 12);
  assert.equal(inferTubeSize(50), null);
  assert.throws(() => fiberColor(0), FiberColorError);
  assert.throws(() => fiberColor(1.5), FiberColorError);
});

/* -- the splice diagram ---------------------------------------------------- */

/** Pole 1748: P0004 in on 28, 1x8 -> S1-7 on 33-39, S8 -> 1x8 -> T1-6 on 41-46,
 *  T7 leaves south on 47, T8 feeds a local 1x2. */
const POLE_1748 = Object.freeze({
  id: "1748",
  name: "POLE 1748",
  enclosure: "FOSC 450 B6",
  cableIn: { id: "RuidosoCable-11726", string: "XD:1-27;1635CA:P0004;XD:29-48", fiberCount: 48, tubeSize: 24 },
  cablesOut: [
    {
      id: "RuidosoCable-11801", heading: "West", primary: true, fiberCount: 48, tubeSize: 24,
      string: "XD:1-32;1635CA,P0004:S1-7;XD:40;1635CA,P0004,S8:T1-6;XD:47-48",
    },
    {
      id: "RuidosoCable-11844", heading: "South", primary: false, fiberCount: 48, tubeSize: 24,
      string: "XD:1-46;1635CA,P0004,S8:T7;XD:48",
    },
  ],
  splitters: [
    { id: "SPL-P0004", ratio: "1x8", label: "P0004", inputLabel: "1635CA,P0004", outputs: ["S1", "S2", "S3", "S4", "S5", "S6", "S7", "S8"] },
    { id: "SPL-S8", ratio: "1x8", label: "S8", inputLabel: "1635CA,P0004,S8", outputs: ["T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8"] },
  ],
  drops: [{ leg: "T8", address: "local 1x2", inputLabel: "1635CA,P0004,S8" }],
});

test("Pole 1748 golden: every leg lands on the fiber the design says", () => {
  const inParsed = parseCableString(POLE_1748.cableIn.string);
  const outParsed = parseCableString(POLE_1748.cablesOut[0].string);
  const southParsed = parseCableString(POLE_1748.cablesOut[1].string);

  const fiberOf = (parsed, label) => parsed.assignments.find((a) => a.label === label)?.fiber ?? null;

  assert.equal(fiberOf(inParsed, "1635CA:P0004"), 28, "P0004 arrives on fiber 28");
  for (let leg = 1; leg <= 7; leg += 1){
    assert.equal(fiberOf(outParsed, `1635CA,P0004:S${leg}`), 32 + leg, `S${leg} on fiber ${32 + leg}`);
  }
  for (let leg = 1; leg <= 6; leg += 1){
    assert.equal(fiberOf(outParsed, `1635CA,P0004,S8:T${leg}`), 40 + leg, `T${leg} on fiber ${40 + leg}`);
  }
  assert.equal(fiberOf(southParsed, "1635CA,P0004,S8:T7"), 47, "T7 leaves south on fiber 47");
  // S8 and T8 are consumed by the second splitter and the local drop, so they
  // deliberately occupy no fiber on any cable
  assert.equal(fiberOf(outParsed, "1635CA,P0004:S8"), null);
  assert.equal(fiberOf(outParsed, "1635CA,P0004,S8:T8"), null);
});

test("Pole 1748 golden: the diagram reports the cascade it was given", () => {
  const svg = renderSpliceDiagram(POLE_1748);
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  assert.match(svg, /<\/svg>$/);
  assert.ok(svg.includes("POLE 1748 — FOSC 450 B6"), "title names the pole and enclosure");
  assert.equal((svg.match(/>1x8</g) || []).length, 2, "both 1x8 splitters are drawn");

  // S8 feeds the downstream splitter; T8 is the local drop; T7 leaves south
  assert.ok(svg.includes("S8 → 1x8 (S8)"), "S8 is shown feeding the second splitter");
  assert.ok(svg.includes("T8 → local 1x2"), "T8 is shown as the local drop");
  assert.ok(svg.includes("T7 → South"), "T7 is shown leaving on the south cable");
  assert.ok(!svg.includes("not in any cable string"), "no leg is falsely reported missing");

  // the raw source strings are reproduced as a footnote
  assert.ok(svg.includes(POLE_1748.cableIn.string), "IN string is reproduced");
  assert.ok(svg.includes(POLE_1748.cablesOut[0].string), "primary OUT string is reproduced");
  assert.ok(svg.includes(POLE_1748.cablesOut[1].string), "secondary OUT string is reproduced");
  assert.ok(svg.includes("LEGEND"));
});

test("the same pole always renders a byte-identical diagram", () => {
  const first = renderSpliceDiagram(POLE_1748);
  const second = renderSpliceDiagram(POLE_1748);
  const third = renderSpliceDiagram(JSON.parse(JSON.stringify(POLE_1748)));
  assert.equal(first, second, "two renders of one object must match exactly");
  assert.equal(first, third, "a structurally equal pole must render identically");
  // no clock or randomness leaked into the output
  assert.doesNotMatch(first, /\d{4}-\d{2}-\d{2}T/);
});

test("rendering never mutates the pole it was given", () => {
  const snapshot = JSON.stringify(POLE_1748);
  renderSpliceDiagram(POLE_1748, { annotations: { verified: true, splitters: { "SPL-P0004": { inputDbm: -12.4, status: "PASS" } } } });
  assert.equal(JSON.stringify(POLE_1748), snapshot);
});

test("a pole without a usable IN cable is refused, not half-drawn", () => {
  assert.throws(() => renderSpliceDiagram(null), SpliceDiagramError);
  assert.throws(() => renderSpliceDiagram({ name: "P" }), /needs an IN cable/);
  assert.throws(
    () => renderSpliceDiagram({ name: "P", cableIn: { id: "c", string: "XD:1-25;XD:30-40" } }),
    /could not be parsed/,
  );
});

/* -- optical annotation gating -------------------------------------------- */

const ANNOTATION = Object.freeze({
  splitters: { "SPL-P0004": { inputDbm: -12.4, throughDbm: -13.9, tapDbm: -22.1, status: "PASS" } },
});

test("unverified specifications never put an unlabelled dBm on the diagram", () => {
  const withheld = renderSpliceDiagram(POLE_1748, { annotations: { ...ANNOTATION, verified: false } });
  assert.doesNotMatch(withheld, /dBm/, "no power value may be drawn from unverified specs");
  assert.match(withheld, /Optical values withheld: PCOT specifications are not verified\./);

  const optedIn = renderSpliceDiagram(POLE_1748, { annotations: { ...ANNOTATION, verified: false }, showUnverified: true });
  assert.match(optedIn, /dBm/, "opting in draws the values");
  assert.match(optedIn, /UNVERIFIED/, "and every one of them is labelled UNVERIFIED");
});

test("verified specifications annotate the diagram with power and status", () => {
  const svg = renderSpliceDiagram(POLE_1748, { annotations: { ...ANNOTATION, verified: true } });
  assert.ok(svg.includes("-12.40 dBm"), "input power is drawn");
  assert.ok(svg.includes("-13.90 dBm"), "through power is drawn");
  assert.ok(svg.includes("-22.10 dBm"), "tap power is drawn");
  assert.match(svg, />PASS</, "the margin status badge is drawn");
  assert.doesNotMatch(svg, /UNVERIFIED/, "verified values carry no UNVERIFIED label");
});

test("with no annotations at all the diagram carries no power figures", () => {
  const svg = renderSpliceDiagram(POLE_1748);
  assert.doesNotMatch(svg, /dBm/);
  assert.doesNotMatch(svg, /PASS|MARGINAL|FAIL/);
});

/* -- pole assembly --------------------------------------------------------- */

test("a cable count is read from the TDS labor unit", () => {
  assert.equal(fiberCountFromLaborUnit("CO(48)(FD)6M"), 48);
  assert.equal(fiberCountFromLaborUnit("CO(144)(FD)6M"), 144);
  assert.equal(fiberCountFromLaborUnit("N/A"), null);
  assert.equal(fiberCountFromLaborUnit(null), null);
});

test("splitters are rebuilt from their tap positions, keeping the declared ratio", () => {
  const splitters = splittersFromDevices([
    { node: "1635CA", pon: "P0003", branch: "S6", position: "T1", splitterRatio: 8 },
    { node: "1635CA", pon: "P0003", branch: "S6", position: "T2", splitterRatio: 8 },
    { node: "1635CA", pon: "P0002", branch: "S3", position: "L1", splitterRatio: 4 },
  ]);
  assert.equal(splitters.length, 2);
  const s6 = splitters.find((s) => s.inputLabel === "1635CA,P0003,S6");
  // only two positions were exported, but the declared ratio still wins
  assert.equal(s6.ratio, "1x8");
  assert.deepEqual(s6.outputs, ["T1", "T2"]);
  assert.equal(s6.ratioConflict, null);

  const conflicted = splittersFromDevices([
    { node: "N", pon: "P1", branch: "S1", position: "T1", splitterRatio: 8 },
    { node: "N", pon: "P1", branch: "S1", position: "T2", splitterRatio: 4 },
  ]);
  assert.deepEqual(conflicted[0].ratioConflict, ["4", "8"], "a disagreeing ratio is surfaced");
});

test("direction is never assumed and resolving it does not mutate the pole", () => {
  const { poles } = buildSplicePoles({
    cables: [
      { name: "A", startCp: "1", endCp: "2", cableCount: "XD:1-48", laborUnit: "CO(48)(FD)6M" },
      { name: "B", startCp: "2", endCp: "3", cableCount: "XD:1-48", laborUnit: "CO(48)(FD)6M" },
    ],
    cpToNp: { 1: "100", 2: "200", 3: "300" },
    networkPoints: [{ np: "200", type: "Pole" }],
    devices: [],
  });
  const pole = poles.find((p) => p.id === "200");
  assert.ok(pole, "the shared network point becomes a pole");
  assert.equal(pole.cables.length, 2);
  assert.equal(pole.directionResolved, false, "direction is not guessed at import");

  const snapshot = JSON.stringify(pole);
  const resolved = resolveDirection(pole, "A");
  assert.equal(resolved.directionResolved, true);
  assert.equal(resolved.cableIn.id, "A");
  assert.equal(resolved.cablesOut[0].id, "B");
  assert.equal(resolved.cablesOut[0].primary, true);
  assert.equal(JSON.stringify(pole), snapshot, "the source pole is untouched");
  assert.throws(() => resolveDirection(pole, "NOPE"), /is not attached to pole 200/);
});

test("a rejected cable string is recorded on the pole rather than dropped", () => {
  const { poles, warnings } = buildSplicePoles({
    cables: [
      { name: "BAD", startCp: "1", endCp: "2", cableCount: "XD:1-25;XD:30-48", laborUnit: "CO(48)(FD)6M" },
    ],
    cpToNp: { 1: "100", 2: "200" },
    networkPoints: [],
    devices: [],
  });
  assert.ok(poles.every((p) => p.parseErrors === 1));
  assert.ok(warnings.length >= 1);
  assert.match(warnings[0], /XD range "30-48" starts at fiber 30/);
});

test("a pole carries the coordinates the design recorded for it", () => {
  // extractTdsDesign() stores a network point's position as `coords`; reading a
  // flat `lat`/`lng` off the record instead left every pole at null, so nothing
  // downstream could place a pole on a map.
  const { poles } = buildSplicePoles({
    cables: [{ name: "A", startCp: "1", endCp: "2", cableCount: "XD:1-48", laborUnit: "CO(48)(FD)6M" }],
    cpToNp: { 1: "100", 2: "1748" },
    networkPoints: [{ np: "1748", type: "Pole", coords: { lat: 33.3672, lng: -105.674 } }],
    devices: [],
  });
  const pole = poles.find((p) => p.id === "1748");
  assert.equal(pole.lat, 33.3672);
  assert.equal(pole.lng, -105.674);
});

test("a hand-built network point may still carry flat lat/lng", () => {
  const { poles } = buildSplicePoles({
    cables: [{ name: "A", startCp: "1", endCp: "2", cableCount: "XD:1-48", laborUnit: "CO(48)(FD)6M" }],
    cpToNp: { 1: "100", 2: "200" },
    networkPoints: [{ np: "200", type: "Pole", lat: 33.1, lng: -105.1 }],
    devices: [],
  });
  assert.equal(poles.find((p) => p.id === "200").lat, 33.1);
});

test("an endpoint that is not a network point is flagged, not called a pole", () => {
  const { poles, warnings } = buildSplicePoles({
    cables: [{ name: "A", startCp: "1", endCp: "2", cableCount: "XD:1-48", laborUnit: "CO(48)(FD)6M" }],
    cpToNp: { 1: "1748", 2: "12801" },
    networkPoints: [{ np: "1748", type: "Pole", coords: { lat: 33.3672, lng: -105.674 } }],
    devices: [],
  });
  assert.equal(poles.find((p) => p.id === "1748").isNetworkPoint, true);
  assert.equal(poles.find((p) => p.id === "12801").isNetworkPoint, false,
    "a connectivity point used as an endpoint is not a pole");
  assert.ok(warnings.some((line) => /12801 .* is not a pole/.test(line)));
  assert.equal(poles.length, 2, "its cables are still kept, not dropped");
});

test("a manual pole validates its strings before it is accepted", () => {
  const pole = buildManualPole({
    name: "POLE 1748",
    inCable: { id: "in", string: "XD:1-27;1635CA:P0004;XD:29-48" },
    outCables: [{ id: "out", string: "XD:1-48" }],
  });
  assert.equal(pole.source, "MANUAL_ENTRY");
  assert.equal(pole.directionResolved, true);
  assert.equal(pole.cablesOut[0].primary, true);
  assert.throws(() => buildManualPole({ name: "x" }), /needs an IN cable/);
  assert.throws(
    () => buildManualPole({ name: "x", inCable: { id: "in", string: "XD:1-25;XD:30-48" } }),
    CableStringError,
  );
});

/* -- app wiring ------------------------------------------------------------ */

test("#ebc is a registered route in both directions", () => {
  assert.match(appSource, /if \(routeToken === "ebc" \|\| routeToken === "fiber" \|\| routeToken === "viewebc"\) return "viewEbc";/);
  assert.match(appSource, /\} else if \(viewId === "viewEbc"\)\{\s*nextHash = "#ebc";/);
});

test("the Fiber Engineer screen is a three-tab shell", () => {
  assert.match(appSource, /const EBC_TABS = Object\.freeze\(\[[\s\S]*?"import"[\s\S]*?"splice"[\s\S]*?"budget"[\s\S]*?\]\)/);
  for (const fn of ["renderEbcImportTab", "renderEbcSpliceTab", "renderEbcBudgetTab", "renderFiberEngineerTabs"]){
    assert.ok(appSource.includes(`function ${fn}(`), `${fn} should exist`);
  }
});

test("the splice tab gates its annotations on approved specifications", () => {
  const body = appSource.match(/function ebcSpliceAnnotations\(\)\{([\s\S]*?)\n\}/)?.[1] || "";
  assert.ok(body, "ebcSpliceAnnotations should exist");
  assert.match(body, /specsAreEngineeringApproved\(/, "verification comes from the spec module");
  assert.match(body, /return null;/, "an uncalculated cascade yields no annotation");
  assert.match(appSource, /renderSpliceDiagram\(resolved, \{ annotations: ebcSpliceAnnotations\(\) \}\)/);
});

test("map location cards can open a pole in the Fiber Engineer", () => {
  assert.match(appSource, /data-action="openFiberEngineer"/);
  assert.match(appSource, /if \(action === "openFiberEngineer"\)\{[\s\S]{0,160}openPoleInFiberEngineer/);
  assert.match(appSource, /window\.openPoleInFiberEngineer = function openPoleInFiberEngineer\(poleId\)\{/);
});
