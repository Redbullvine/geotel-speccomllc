import assert from "node:assert/strict";
import test from "node:test";

import {
  appLocationUrl,
  buildContextKml,
  buildContextKmz,
  buildProjectKml,
  distanceFeet,
  EARTH_LEGEND_ORDER,
  EARTH_STYLE_TABLE,
  EARTH_TYPES,
  earthKmzFileName,
  earthProjectKmzFileName,
  earthStyleFor,
  placemarkName,
  poleNumberFromName,
  resolveDeviceType,
  resolveLocationType,
  selectReferencePoles,
  splitPoleLabel,
} from "../js/earth-export.js";
import { extractTdsDesign } from "../services/ebc/tdsKmzImport.mjs";

/* ==========================================================================
   A TDS-shaped fixture.

   Built to the same record layout the real Ruidoso Project.kmz uses: attributes
   in a two-column HTML table inside each placemark description, connectivity
   points tied to their pole by "Network Point Connectivity Point Is Located At",
   and the device identities the engineer documented. Pole 1748's two 1x8
   splitters match the golden pole in fiberDiagram.test.mjs.
   ========================================================================== */

const BASE_LAT = 33.3672;
const BASE_LNG = -105.674;
/** ~0.00055 deg latitude is ~61 m, ~200 ft — a realistic pole span. */
const STEP = 0.00055;

function row(key, value){
  return `&lt;tr&gt;&lt;td&gt;${key}&lt;/td&gt;&lt;td&gt;${value}&lt;/td&gt;&lt;/tr&gt;`;
}

function placemark(name, fields, geometry){
  const table = `&lt;table&gt;${Object.entries(fields).map(([key, value]) => row(key, value)).join("")}&lt;/table&gt;`;
  return `<Placemark><name>${name}</name><description><![CDATA[${table}]]></description>${geometry}</Placemark>`;
}

function point(lat, lng){
  return `<Point><coordinates>${lng},${lat},0</coordinates></Point>`;
}

function line(points){
  return `<LineString><coordinates>${points.map(([lat, lng]) => `${lng},${lat},0`).join(" ")}</coordinates></LineString>`;
}

/** pole -> { lat, lng } laid out in a straight line north of the target. */
const POLES = {
  1748: { lat: BASE_LAT, lng: BASE_LNG },
  1749: { lat: BASE_LAT + STEP, lng: BASE_LNG },
  1750: { lat: BASE_LAT + STEP * 2, lng: BASE_LNG },
  1751: { lat: BASE_LAT - STEP, lng: BASE_LNG },
  1752: { lat: BASE_LAT - STEP * 2, lng: BASE_LNG },
  2017: { lat: BASE_LAT, lng: BASE_LNG + STEP },
  2103: { lat: BASE_LAT, lng: BASE_LNG - STEP },
  9001: { lat: BASE_LAT + STEP * 40, lng: BASE_LNG }, // ~8000 ft away
};

function buildFixtureKml(){
  const marks = [];

  for (const [pole, coords] of Object.entries(POLES)){
    marks.push(placemark(`RuidosoNetworkPoint-${pole}`, {
      "Network Point Name": `RuidosoNetworkPoint-${pole}`,
      "Network Point Type": "Pole",
      "Project": "1635CA_02",
    }, point(coords.lat, coords.lng)));
  }

  // Connectivity points (splice enclosures) and the pole each sits on.
  const enclosures = [
    ["11726", "1748", "FOSC(450)B6"],
    ["11801", "1749", "HAFO(PCOT)LO"],
    ["11844", "1751", "FOSC(450)B6"],
    ["13803", "2017", "HAFO(PCOT)LO"],
    ["13804", "2103", "HAFO(PCOT)LO"],
    ["13900", "1750", "FOSC(450)B6"],
  ];
  for (const [cp, np, enclosureUnit] of enclosures){
    marks.push(placemark(`RuidosoConnectivityPoint-${cp}`, {
      "Connectivity Point Name": `RuidosoConnectivityPoint-${cp}`,
      "Network Point Connectivity Point Is Located At": `RuidosoNetworkPoint-${np}`,
      "Enclosure Unit": enclosureUnit,
      "Project": "1635CA_02",
    }, point(POLES[np].lat, POLES[np].lng)));
  }

  // Devices. 1748 carries the two 1x8 splitters of the golden pole.
  const devices = [
    ["RuidosoNetworkDevice-1", "11726", { "Material Unit": "Splitter(1x8)", "Network Device Type": "3", "MarketName": "Ruidoso" }],
    ["RuidosoNetworkDevice-2", "11726", { "Material Unit": "Splitter(1x8)", "Network Device Type": "3", "MarketName": "Ruidoso" }],
    ["RuidosoNetworkDevice-3", "11844", { "Material Unit": "Splitter(1x4)", "Network Device Type": "3", "MarketName": "Ruidoso" }],
    ["RuidosoNetworkDevice-4", "13900", {
      "Material Unit": "HxFO(1x4)PCOT(90/10)MO", "Network Device Type": "2",
      "Splitter Path": "1635CA,P0002,S8:L1", "Splitter Order": "1", "Optical Tap Ratio": "90/10",
      "Splitter Ratio": "4", "MarketName": "Ruidoso",
    }],
    // A device the export gives no identity for: must stay UNKNOWN.
    ["RuidosoNetworkDevice-5", "11801", { "Material Unit": "<Null>", "Network Device Type": "4", "Splitter Order": "<Null>", "Splitter Ratio": "<Null>" }],
  ];
  for (const [name, cp, fields] of devices){
    const np = enclosures.find((entry) => entry[0] === cp)[1];
    marks.push(placemark(name, {
      "Network Device Name": name,
      "Connectivity Point Name": `RuidosoConnectivityPoint-${cp}`,
      "Project": "1635CA_02",
      ...fields,
    }, point(POLES[np].lat, POLES[np].lng)));
  }

  // One cable with real geometry, one without.
  marks.push(placemark("RuidosoCable-11726", {
    "Cable Name": "RuidosoCable-11726",
    "Connectivity Point ID Where Cable Starts": "RuidosoConnectivityPoint-11726",
    "Connectivity Point ID Where Cable Ends": "RuidosoConnectivityPoint-11801",
    "Labor or Labor/Material Amount": "204",
    "Labor or Labor/Material Unit": "CO(48)(FD)6M",
    "Cable Count": "XD:1-48",
  }, line([[POLES[1748].lat, POLES[1748].lng], [POLES[1749].lat, POLES[1749].lng]])));

  marks.push(placemark("RuidosoCable-11844", {
    "Cable Name": "RuidosoCable-11844",
    "Connectivity Point ID Where Cable Starts": "RuidosoConnectivityPoint-11726",
    "Connectivity Point ID Where Cable Ends": "RuidosoConnectivityPoint-11844",
    "Labor or Labor/Material Amount": "198",
  }, ""));

  return `<?xml version="1.0" encoding="UTF-8"?><kml><Document>${marks.join("")}</Document></kml>`;
}

const DESIGN = extractTdsDesign(buildFixtureKml());

/** The pole index the app builds, reproduced here from the design alone. */
function poleIndexFromDesign(design){
  const index = new Map();
  const entryFor = (pole) => {
    const key = String(pole || "");
    if (!key) return null;
    if (!index.has(key)) index.set(key, { pole: key, lat: null, lng: null, devices: [], enclosureUnit: null, hasEnclosure: false });
    return index.get(key);
  };
  for (const np of design.networkPoints){
    const entry = entryFor(np.np);
    if (entry && np.coords){ entry.lat = np.coords.lat; entry.lng = np.coords.lng; }
  }
  for (const cp of design.connectivityPoints){
    const entry = entryFor(cp.np);
    if (!entry) continue;
    entry.hasEnclosure = true;
    entry.enclosureUnit = entry.enclosureUnit || cp.enclosureUnit;
  }
  for (const device of design.allDevices){
    const entry = entryFor(device.np);
    if (!entry) continue;
    entry.hasEnclosure = true;
    entry.devices.push(device);
  }
  for (const entry of index.values()) entry.type = resolveLocationType(entry);
  return index;
}

const INDEX = poleIndexFromDesign(DESIGN);

/* -- pole numbers ---------------------------------------------------------- */

test("a pole number is the numeric suffix of the network point name", () => {
  assert.equal(poleNumberFromName("RuidosoNetworkPoint-1654"), "1654");
  assert.equal(poleNumberFromName("RuidosoNetworkPoint-1748"), "1748");
  assert.equal(poleNumberFromName("POLE 1748"), "1748");
  assert.equal(poleNumberFromName("1748"), "1748");
});

test("an ambiguous name is not guessed at", () => {
  assert.equal(poleNumberFromName("MST-3 / East Pedestal"), "3", "one digit run resolves");
  assert.equal(poleNumberFromName("MST-3 near 1748 pole A"), "", "two digit runs and no suffix resolves to nothing");
  assert.equal(poleNumberFromName(""), "");
});

/* -- device identity ------------------------------------------------------- */

test("each documented Material Unit resolves to the engineer's device", () => {
  assert.equal(resolveDeviceType({ materialUnit: "Splitter(1x8)" }), EARTH_TYPES.SPLITTER_1X8);
  assert.equal(resolveDeviceType({ materialUnit: "Splitter(1x4)" }), EARTH_TYPES.SPLITTER_1X4);
  assert.equal(resolveDeviceType({ materialUnit: "HxFO(1x2)PCOT(90/10)MO", deviceType: "2" }), EARTH_TYPES.PCOT_TAP_1X2);
  assert.equal(resolveDeviceType({ materialUnit: "HxFO(1x4)PCOT(60/40)MO", deviceType: "2" }), EARTH_TYPES.PCOT_TAP_1X4);
});

test("a tap leg needs the full signature the engineer documented", () => {
  const leg = { deviceType: "1", materialUnit: "N/A", splitterOrder: "3" };
  assert.equal(resolveDeviceType({ ...leg, splitterRatio: "2" }), EARTH_TYPES.TAP_LEG_1X2);
  assert.equal(resolveDeviceType({ ...leg, splitterRatio: "4" }), EARTH_TYPES.TAP_LEG_1X4);
  // Any part of the signature missing or different is not a tap leg.
  assert.equal(resolveDeviceType({ ...leg, splitterRatio: "8" }), EARTH_TYPES.UNKNOWN);
  assert.equal(resolveDeviceType({ ...leg, splitterOrder: "1", splitterRatio: "2" }), EARTH_TYPES.UNKNOWN);
  assert.equal(resolveDeviceType({ ...leg, deviceType: "2", splitterRatio: "2" }), EARTH_TYPES.UNKNOWN);
});

test("an unrecognised material unit is UNKNOWN, never the nearest guess", () => {
  assert.equal(resolveDeviceType({ materialUnit: "Splitter(1x16)" }), EARTH_TYPES.UNKNOWN);
  assert.equal(resolveDeviceType({ materialUnit: "HxFO(1x8)PCOT(50/50)MO" }), EARTH_TYPES.UNKNOWN);
  assert.equal(resolveDeviceType({}), EARTH_TYPES.UNKNOWN);
  assert.equal(resolveDeviceType(null), EARTH_TYPES.UNKNOWN);
});

/* -- location identity ----------------------------------------------------- */

test("Pole 1748 resolves to the 1x8 splitter the FAD shows, in the engineer's red", () => {
  const target = INDEX.get("1748");
  assert.equal(target.devices.length, 2, "both 1x8 splitters are read off the export");
  assert.equal(target.type, EARTH_TYPES.SPLITTER_1X8);
  assert.equal(earthStyleFor(target.type).color, "ff0000ff");
  assert.equal(earthStyleFor(target.type).label, "1x8 splitter");
});

test("a PCOT enclosure with no device is pass-through, not '?'", () => {
  for (const pole of ["2017", "2103"]){
    const entry = INDEX.get(pole);
    assert.equal(entry.devices.length, 0, `${pole} carries no device`);
    assert.equal(entry.enclosureUnit, "HAFO(PCOT)LO");
    assert.equal(entry.type, EARTH_TYPES.PASS_THROUGH, `${pole} is MST-only`);
    assert.equal(earthStyleFor(entry.type).color, "ffffffff");
  }
});

test("a 1x4 PCOT tap keeps its own darker cyan", () => {
  const entry = INDEX.get("1750");
  assert.equal(entry.type, EARTH_TYPES.PCOT_TAP_1X4);
  assert.equal(earthStyleFor(entry.type).color, "ffe6a000");
});

test("a location whose device does not resolve exports gray '?'", () => {
  const entry = INDEX.get("1749");
  assert.equal(entry.devices.length, 1, "there is a device here");
  assert.equal(entry.type, EARTH_TYPES.UNKNOWN);
  assert.equal(earthStyleFor(entry.type).color, "ff888888");
  assert.equal(earthStyleFor(entry.type).label, "?");
});

test("a pole the export lists with no enclosure is a plain black dot", () => {
  const entry = INDEX.get("1752");
  assert.equal(entry.hasEnclosure, false);
  assert.equal(entry.type, EARTH_TYPES.POLE);
  assert.equal(earthStyleFor(entry.type).color, "ff000000");
  assert.equal(earthStyleFor(entry.type).label, "", "a plain pole is labelled by its number alone");
});

test("silence from the dataset is not evidence of an empty pole", () => {
  assert.equal(resolveLocationType({ devices: [], hasEnclosure: undefined }), EARTH_TYPES.UNKNOWN);
  assert.equal(resolveLocationType({ devices: [], hasEnclosure: false }), EARTH_TYPES.POLE);
});

test("the colour table is the engineer's, byte for byte", () => {
  assert.deepEqual(
    Object.fromEntries(Object.entries(EARTH_STYLE_TABLE).map(([type, style]) => [type, style.color])),
    {
      SPLITTER_1X8: "ff0000ff",
      SPLITTER_1X4: "ff00ff55",
      PCOT_TAP_1X2: "ffffc500",
      PCOT_TAP_1X4: "ffe6a000",
      TAP_LEG_1X2: "ffe65c00",
      TAP_LEG_1X4: "ffe65c00",
      PASS_THROUGH: "ffffffff",
      POLE: "ff000000",
      UNKNOWN: "ff888888",
    },
  );
});

/* -- reference poles ------------------------------------------------------- */

test("reference poles are the nearest inside the radius, capped at the limit", () => {
  const target = INDEX.get("1748");
  const chosen = selectReferencePoles(target, [...INDEX.values()], { limit: 8, radiusFeet: 500, minimum: 4 });
  assert.ok(chosen.length >= 4, "at least four neighbours");
  assert.ok(!chosen.some((entry) => entry.pole === "1748"), "the target is never its own reference");
  assert.ok(!chosen.some((entry) => entry.pole === "9001"), "a pole 8000 ft away is outside the radius");
  const distances = chosen.map((entry) => entry.distanceFeet);
  assert.deepEqual(distances, [...distances].sort((a, b) => a - b), "nearest first");
  assert.ok(distances.every((value) => value <= 500));
});

test("a sparse run falls back to the nearest four regardless of radius", () => {
  const target = { pole: "1748", lat: BASE_LAT, lng: BASE_LNG };
  const far = [1, 2, 3, 4, 5].map((index) => ({
    pole: `800${index}`,
    lat: BASE_LAT + STEP * 10 * index,
    lng: BASE_LNG,
  }));
  const chosen = selectReferencePoles(target, far, { limit: 8, radiusFeet: 500, minimum: 4 });
  assert.equal(chosen.length, 4);
  assert.deepEqual(chosen.map((entry) => entry.pole), ["8001", "8002", "8003", "8004"]);
  assert.ok(chosen[0].distanceFeet > 500, "the fallback deliberately reaches past the radius");
});

test("a candidate without coordinates is dropped rather than placed at 0,0", () => {
  const target = { pole: "1748", lat: BASE_LAT, lng: BASE_LNG };
  const chosen = selectReferencePoles(target, [
    { pole: "1749", lat: null, lng: null },
    { pole: "1750", lat: BASE_LAT + STEP, lng: BASE_LNG },
  ], { minimum: 1 });
  assert.deepEqual(chosen.map((entry) => entry.pole), ["1750"]);
});

test("distance is measured in feet", () => {
  // One step of latitude is ~61 m ~ 200 ft.
  const feet = distanceFeet({ lat: BASE_LAT, lng: BASE_LNG }, { lat: BASE_LAT + STEP, lng: BASE_LNG });
  assert.ok(feet > 190 && feet < 210, `expected ~200 ft, got ${feet}`);
});

/* -- the KML document ------------------------------------------------------ */

function buildFixtureKmlDocument(overrides = {}){
  const target = { ...INDEX.get("1748"), summary: [{ label: "Enclosure unit", value: "FOSC(450)B6" }] };
  const references = selectReferencePoles(target, [...INDEX.values()], { limit: 8, radiusFeet: 500, minimum: 4 });
  return buildContextKml({
    target,
    references,
    paths: [{ name: "RuidosoCable-11726", coordinates: [POLES[1748], POLES[1749]] }],
    projectSlug: "ruidoso",
    ...overrides,
  });
}

test("the document is well-formed KML centred on the target", () => {
  const kml = buildFixtureKmlDocument();
  assert.match(kml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(kml, /<kml xmlns="http:\/\/www\.opengis\.net\/kml\/2\.2">/);
  assert.match(kml, /<\/Document><\/kml>$/);
  assert.ok(kml.includes("<name>TelecomEngine — Pole 1748</name>"));
  assert.match(kml, /<LookAt>.*<tilt>0<\/tilt><range>250<\/range>.*<\/LookAt>/s);
  assert.ok(kml.includes(`<latitude>${BASE_LAT.toFixed(8)}</latitude>`));
});

test("the four folders are present in order", () => {
  const kml = buildFixtureKmlDocument();
  const folders = [...kml.matchAll(/<Folder><name>([^<]+)<\/name>/g)].map((match) => match[1]);
  assert.deepEqual(folders, ["Target", "Reference Poles", "Paths", "Legend"]);
});

test("the target pin is named and coloured by its resolved type", () => {
  const kml = buildFixtureKmlDocument();
  assert.ok(kml.includes("<name>Pole 1748 · 1x8 splitter</name>"));
  assert.ok(kml.includes(`<styleUrl>#te-target-splitter-1x8</styleUrl>`));
  assert.match(kml, /<Style id="te-target-splitter-1x8"><IconStyle><color>ff0000ff<\/color><scale>1\.5<\/scale>/);
});

test("the target description carries the summary and the link back to the app", () => {
  const kml = buildFixtureKmlDocument();
  assert.ok(kml.includes("FOSC(450)B6"), "the app's own summary rows are reproduced");
  assert.ok(kml.includes("https://telecomengine.app/?project=ruidoso&amp;pole=1748"));
});

test("reference poles are readable pins with a label scale of 1.1", () => {
  const kml = buildFixtureKmlDocument();
  const referenceBlock = kml.slice(kml.indexOf("<Folder><name>Reference Poles"), kml.indexOf("<Folder><name>Paths"));
  const names = [...referenceBlock.matchAll(/<name>([^<]+)<\/name>/g)].map((match) => match[1]).slice(1);
  assert.ok(names.length >= 4, `expected at least four neighbours, got ${names.length}`);
  assert.ok(names.includes("1752"), "a plain pole shows its number alone");
  assert.ok(names.includes("1749 · ?"), "an unresolved neighbour is marked, not guessed");
  assert.ok(names.some((name) => name === "1751 · 1x4 splitter"), "a neighbouring splitter shows its type");
  assert.match(kml, /<Style id="te-ref-pole">.*<LabelStyle><scale>1\.1<\/scale><\/LabelStyle>/s);
});

test("reference pins are smaller than the target", () => {
  const kml = buildFixtureKmlDocument();
  const target = /<Style id="te-target-splitter-1x8">.*?<scale>([\d.]+)<\/scale>/s.exec(kml)[1];
  const reference = /<Style id="te-ref-splitter-1x8">.*?<scale>([\d.]+)<\/scale>/s.exec(kml)[1];
  assert.ok(Number(reference) < Number(target), `${reference} should be smaller than ${target}`);
});

test("path geometry is drawn thin and gray, and never invented", () => {
  const withPath = buildFixtureKmlDocument();
  assert.match(withPath, /<Style id="te-path"><LineStyle><color>ff888888<\/color><width>2<\/width>/);
  assert.ok(withPath.includes("<name>RuidosoCable-11726</name>"));

  const withoutPath = buildFixtureKmlDocument({ paths: [] });
  assert.ok(!withoutPath.includes("<Folder><name>Paths</name>"), "no geometry means no Paths folder");
  assert.ok(!withoutPath.includes("<LineString>"), "a missing path is never drawn as a straight guess");

  const singlePoint = buildFixtureKmlDocument({ paths: [{ name: "stub", coordinates: [POLES[1748]] }] });
  assert.ok(!singlePoint.includes("<LineString>"), "a one-point path is not a line");
});

test("the legend is one hidden placemark per colour", () => {
  const kml = buildFixtureKmlDocument();
  const legend = kml.slice(kml.indexOf("<Folder><name>Legend</name>"));
  assert.ok(legend.includes("<visibility>0</visibility>"), "the folder itself is hidden");
  const entries = [...legend.matchAll(/<name>([^<]+)<\/name>/g)].map((match) => match[1]).slice(1);
  assert.equal(entries.length, EARTH_LEGEND_ORDER.length);
  assert.equal(entries.length, 7);
  assert.deepEqual(entries, EARTH_LEGEND_ORDER.map((type) => earthStyleFor(type).legend));
  assert.equal((legend.match(/<visibility>0<\/visibility>/g) || []).length, 1 + entries.length,
    "every legend placemark is hidden so the map stays clean");
});

test("a target without coordinates or a pole number is refused, not faked", () => {
  assert.throws(() => buildContextKml({ target: { pole: "1748" } }), /coordinates/);
  assert.throws(() => buildContextKml({ target: { lat: BASE_LAT, lng: BASE_LNG } }), /pole number/);
});

/* -- packaging ------------------------------------------------------------- */

test("the file name follows TE_<project>_Pole<####>.kmz", () => {
  assert.equal(earthKmzFileName({ projectSlug: "ruidoso", pole: "1748" }), "TE_ruidoso_Pole1748.kmz");
  assert.equal(earthKmzFileName({ projectSlug: "Ruidoso Revisit", pole: "2017" }), "TE_ruidoso-revisit_Pole2017.kmz");
});

test("the app link carries the project and the pole", () => {
  assert.equal(
    appLocationUrl({ projectSlug: "ruidoso", pole: "1748" }),
    "https://telecomengine.app/?project=ruidoso&pole=1748",
  );
});

test("placemark names read the way the splicer reads the sheet", () => {
  assert.equal(placemarkName("1748", EARTH_TYPES.SPLITTER_1X4, { withPolePrefix: true }), "Pole 1748 · 1x4 splitter");
  assert.equal(placemarkName("1752", EARTH_TYPES.POLE), "1752");
  assert.equal(placemarkName("1749", EARTH_TYPES.UNKNOWN), "1749 · ?");
});

test("the kmz is a zip carrying exactly one doc.kml", async () => {
  // A minimal in-memory stand-in for the zip library the browser already loads.
  const written = new Map();
  class FakeZip {
    file(name, content){ written.set(name, content); }
    async generateAsync(){ return { entries: [...written.keys()] }; }
  }
  const { blob, kml } = await buildContextKmz(
    { target: { ...INDEX.get("1748"), summary: [] }, references: [], projectSlug: "ruidoso" },
    { loadZip: async () => FakeZip },
  );
  assert.deepEqual(blob.entries, ["doc.kml"]);
  assert.equal(written.get("doc.kml"), kml);
  assert.ok(kml.includes("Pole 1748"));
});

test("buildContextKmz refuses to run without a zip factory", async () => {
  await assert.rejects(
    () => buildContextKmz({ target: INDEX.get("1748") }, {}),
    /loadZip/,
  );
});

/* -- labels: pole number, and the street address when the data has one ------ */

test("a label pairs the pole number with its street address", () => {
  assert.equal(
    placemarkName("2015", EARTH_TYPES.PASS_THROUGH, { address: "103 Klamath Rd" }),
    "2015 · 103 Klamath Rd",
  );
  assert.equal(
    placemarkName("2017", EARTH_TYPES.PCOT_TAP_1X4, { address: "203 Klamath Rd" }),
    "2017 · 203 Klamath Rd",
  );
});

test("with no address the device identifies the pole instead", () => {
  assert.equal(placemarkName("1751", EARTH_TYPES.SPLITTER_1X4), "1751 · 1x4 splitter");
  assert.equal(placemarkName("1752", EARTH_TYPES.POLE), "1752", "a plain pole is its number alone");
  assert.equal(placemarkName("1749", EARTH_TYPES.UNKNOWN), "1749 · ?");
});

test("a blank address never displaces the device label", () => {
  assert.equal(placemarkName("1751", EARTH_TYPES.SPLITTER_1X4, { address: "   " }), "1751 · 1x4 splitter");
});

test("the context KML carries the address through to the label", () => {
  const target = { ...INDEX.get("1748"), address: "204 Angeles Dr", summary: [] };
  const kml = buildContextKml({
    target,
    references: [{ ...INDEX.get("1751"), address: "206 Angeles Dr" }],
    projectSlug: "ruidoso",
  });
  assert.ok(kml.includes("<name>Pole 1748 · 204 Angeles Dr</name>"));
  assert.ok(kml.includes("<name>1751 · 206 Angeles Dr</name>"));
});

/* -- the whole-project pole layer ------------------------------------------ */

function projectPoles(){
  return [...INDEX.values()].filter((entry) => entry.lat !== null && entry.lng !== null);
}

test("the project layer places every pole that has coordinates", () => {
  const poles = projectPoles();
  const kml = buildProjectKml({ poles, projectName: "ruidoso revisit", projectSlug: "ruidoso" });
  assert.equal((kml.match(/<Point>/g) || []).length, poles.length + EARTH_LEGEND_ORDER.length,
    "one placemark per pole, plus the hidden legend");
  for (const pole of poles){
    assert.ok(kml.includes(`>${pole.pole}`) || kml.includes(`>${pole.pole} ·`), `pole ${pole.pole} is labelled`);
  }
});

test("the project layer groups poles into a folder per device type", () => {
  const kml = buildProjectKml({ poles: projectPoles(), projectSlug: "ruidoso" });
  const folders = [...kml.matchAll(/<Folder><name>([^<]+)<\/name>/g)].map((match) => match[1]);
  assert.ok(folders.some((name) => name.startsWith("1x8 splitters (")), `saw ${folders.join(", ")}`);
  assert.ok(folders.some((name) => name.startsWith("Poles (")));
  assert.ok(folders.some((name) => name.startsWith("Unresolved (")));
  assert.equal(folders.at(-1), "Legend", "the legend stays last");
});

test("the project layer frames the whole run, not one pole", () => {
  const kml = buildProjectKml({ poles: projectPoles(), projectSlug: "ruidoso" });
  const range = Number(/<range>(\d+)<\/range>/.exec(kml)[1]);
  assert.ok(range >= 400, `expected a framing range, got ${range}`);
  assert.match(kml, /<tilt>0<\/tilt>/);
});

test("the project layer keeps the engineer's colours", () => {
  const kml = buildProjectKml({ poles: projectPoles(), projectSlug: "ruidoso" });
  assert.ok(kml.includes(`<styleUrl>#te-ref-splitter-1x8</styleUrl>`));
  assert.match(kml, /<Style id="te-ref-splitter-1x8"><IconStyle><color>ff0000ff<\/color>/);
});

test("the project layer refuses an empty or coordinate-less set", () => {
  assert.throws(() => buildProjectKml({ poles: [] }), /coordinates/);
  assert.throws(() => buildProjectKml({ poles: [{ pole: "1748" }] }), /coordinates/);
});

test("the project file name follows TE_<project>_AllPoles.kmz", () => {
  assert.equal(earthProjectKmzFileName({ projectSlug: "ruidoso" }), "TE_ruidoso_AllPoles.kmz");
  assert.equal(earthProjectKmzFileName({}), "TE_project_AllPoles.kmz");
});

/* -- field labels: "2015 · 103 Klamath Rd" --------------------------------- */

test("a field label yields both the pole number and the address", () => {
  assert.deepEqual(splitPoleLabel("2015 · 103 Klamath Rd"), { pole: "2015", address: "103 Klamath Rd" });
  assert.deepEqual(splitPoleLabel("2017 - 203 Klamath Rd"), { pole: "2017", address: "203 Klamath Rd" });
  assert.deepEqual(splitPoleLabel("13308: 202 Angeles Dr"), { pole: "13308", address: "202 Angeles Dr" });
});

test("a number leading a field label is the pole, not the house number", () => {
  // "103 Klamath Rd" has no trailing run, so without the leading rule the whole
  // label would resolve to nothing and the export button would never appear.
  assert.equal(poleNumberFromName("2015 · 103 Klamath Rd"), "2015");
  assert.equal(poleNumberFromName("2105 · 206 Angeles Dr"), "2105");
});

test("a name that is not number-then-address yields no address", () => {
  assert.deepEqual(splitPoleLabel("RuidosoNetworkPoint-1654"), { pole: "1654", address: "" });
  assert.deepEqual(splitPoleLabel("POLE 1748"), { pole: "1748", address: "" });
  assert.deepEqual(splitPoleLabel("MST-3 near 1748 pole A"), { pole: "", address: "" });
  assert.deepEqual(splitPoleLabel(""), { pole: "", address: "" });
});

test("the existing name shapes still resolve the way they did", () => {
  assert.equal(poleNumberFromName("RuidosoNetworkPoint-1654"), "1654");
  assert.equal(poleNumberFromName("MST-3 / East Pedestal"), "3");
  assert.equal(poleNumberFromName("MST-3 near 1748 pole A"), "");
});
