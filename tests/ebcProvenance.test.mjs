import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  EBC_CANDIDATE_LIMITS,
  EBC_DATA_CLASS,
  EBC_HARDWARE_IDENTIFICATION,
  EBC_LOSS_PROVENANCE,
  EBC_REPORTED_ALTERNATE_LOSS_TABLE,
  EBC_REQUIRED_UNKNOWN_CONSTANTS,
  EBC_VERIFICATION,
  declareConstant,
  describeProvenance,
  isVerifiedLevel,
} from "../services/ebc/engineeringConstants.mjs";

import {
  DEFAULT_PCOT_SPECS,
  calculateLeg,
  configurePcotSpec,
  findNodeResult,
} from "../services/ebc/index.mjs";

import {
  extractTdsDesign,
  parseSplitterPath,
  parseTdsKml,
  tdsIdNumber,
  tdsLegToEbcLeg,
  tdsValue,
} from "../services/ebc/tdsKmzImport.mjs";

import {
  TDS_1X4_IS_SELF_CONSISTENT,
  TDS_COMMSCOPE_CORRELATION,
  TDS_PRICELIST_ANOMALIES,
  TDS_PRICELIST_SOURCE,
  tdsTapLossConstant,
  tdsTapLossDb,
} from "../services/ebc/tdsPricelist.mjs";

import { buildNode54Leg } from "../services/ebc/node54Legs.mjs";

/* ------------------------------------------------------------------ *
 * Provenance of engineering constants
 * ------------------------------------------------------------------ */

test("a constant cannot be promoted to verified by simply claiming it", () => {
  // No source, no part identity: the claim is refused and downgraded.
  const claimed = declareConstant({
    key: "loss.test", value: 1.2, units: "dB",
    verification: EBC_VERIFICATION.MANUFACTURER_VERIFIED,
  });
  assert.equal(claimed.verified, false);
  assert.equal(claimed.verification, EBC_VERIFICATION.UNKNOWN);
  assert.equal(claimed.dataClass, EBC_DATA_CLASS.ESTIMATE);

  // With a citation and a part identity it stands.
  const evidenced = declareConstant({
    key: "loss.test", value: 1.2, units: "dB",
    source: "Example TDS rev C, table 4", manufacturer: "Example Optical",
    model: "PCOT-9010", wavelengthNm: 1550,
    verification: EBC_VERIFICATION.MANUFACTURER_VERIFIED,
  });
  assert.equal(evidenced.verified, true);
  assert.equal(evidenced.dataClass, EBC_DATA_CLASS.ENGINEERING_CONSTANT);

  // Non-verified levels are preserved rather than rewritten.
  const industry = declareConstant({ key: "k", value: 7.5, units: "dB", verification: EBC_VERIFICATION.INDUSTRY_REFERENCE });
  assert.equal(industry.verification, EBC_VERIFICATION.INDUSTRY_REFERENCE);
  assert.equal(industry.verified, false);
  assert.equal(isVerifiedLevel(EBC_VERIFICATION.INDUSTRY_REFERENCE), false);
});

test("every shipped loss figure is a repository estimate and says where it came from", () => {
  for (const [ratio, pair] of Object.entries(EBC_LOSS_PROVENANCE)){
    for (const which of ["through", "tap"]){
      const constant = pair[which];
      assert.equal(constant.verified, false, ratio + " " + which + " must not be verified");
      assert.equal(constant.verification, EBC_VERIFICATION.REPO_ESTIMATE);
      assert.equal(constant.dataClass, EBC_DATA_CLASS.ESTIMATE);
      assert.equal(constant.units, "dB");
      assert.match(constant.source, /node54Diagnostics\.mjs/);
      assert.match(constant.sourceDetail, /a6f0c6f/);
      assert.equal(constant.recordedDate, "2026-08-18");
      // A technician can read where the number came from in one line.
      assert.match(describeProvenance(constant), /Repository estimate/);
    }
  }
});

test("a spec carries provenance for the exact number the engine used", () => {
  const spec = DEFAULT_PCOT_SPECS["90/10"];
  assert.equal(spec.provenance.tap.value, spec.nominalTapLossDb);
  assert.equal(spec.provenance.through.value, spec.nominalThroughLossDb);
  assert.equal(spec.verification, EBC_VERIFICATION.REPO_ESTIMATE);

  // A ratio with no data still carries a record that says so.
  const missing = DEFAULT_PCOT_SPECS["50/50"];
  assert.equal(missing.provenance.tap.value, null);
  assert.equal(missing.provenance.tap.available, false);
  assert.match(describeProvenance(missing.provenance.tap), /No value is configured/);
});

test("configuring a spec rebuilds provenance and refuses an unsupported claim", () => {
  // Complete numbers but no manufacturer: cannot become an engineering constant.
  const noMaker = configurePcotSpec(DEFAULT_PCOT_SPECS, "50/50", {
    nominalThroughLossDb: 3.4, nominalTapLossDb: 3.4,
    maxThroughInsertionLossDb: 4.0, maxTapInsertionLossDb: 4.0,
    model: "PCOT-5050", wavelengthNm: 1550, verified: true,
  });
  assert.equal(noMaker["50/50"].verified, false);

  const full = configurePcotSpec(DEFAULT_PCOT_SPECS, "50/50", {
    nominalThroughLossDb: 3.4, nominalTapLossDb: 3.4,
    maxThroughInsertionLossDb: 4.0, maxTapInsertionLossDb: 4.0,
    manufacturer: "Example Optical", model: "PCOT-5050", wavelengthNm: 1550,
    reference: "Example TDS rev C", verification: EBC_VERIFICATION.MANUFACTURER_VERIFIED,
    recordedDate: "2026-08-21", verified: true,
  });
  assert.equal(full["50/50"].verified, true);
  assert.equal(full["50/50"].dataClass, EBC_DATA_CLASS.ENGINEERING_CONSTANT);
  assert.equal(full["50/50"].provenance.tap.value, 3.4);
  assert.equal(full["50/50"].provenance.tap.manufacturer, "Example Optical");
  assert.equal(full["50/50"].provenance.tap.verified, true);

  // The shipped defaults are untouched by either call.
  assert.equal(DEFAULT_PCOT_SPECS["50/50"].nominalTapLossDb, null);
});

test("the manufacturer is TDS-sourced and cited, not inferred", () => {
  // The TDS pricelist names the vendor on all 56 PCOT rows.
  assert.equal(EBC_HARDWARE_IDENTIFICATION.manufacturer, "CommScope");
  assert.equal(EBC_HARDWARE_IDENTIFICATION.manufacturerVerification, EBC_VERIFICATION.TDS_VERIFIED);
  assert.match(EBC_HARDWARE_IDENTIFICATION.manufacturerSource, /TDS Pricelist/);
  assert.ok(EBC_HARDWARE_IDENTIFICATION.tdsCatalogueCodes.includes("HxFO(1x4)PCOT(90/10)MO"));

  // The HxFO prefix is resolved by evidence, not by assumption: whichever way
  // x resolves, HAFO and HBFO are optically identical.
  assert.equal(EBC_HARDWARE_IDENTIFICATION.prefixResolution.verification, EBC_VERIFICATION.TDS_VERIFIED);
  assert.match(EBC_HARDWARE_IDENTIFICATION.prefixResolution.conclusion, /optically identical/);
});

test("the reported CommScope part is corroborated on spec but still not proven as the part", () => {
  const reported = EBC_HARDWARE_IDENTIFICATION.reportedFieldHardware;
  assert.equal(reported.partNumber, "CommScope OCC1P-TAP-4P-19-S2S2SEB");

  // The exact string still appears in no searched source, including the
  // pricelist and the extracted PDF text.
  assert.equal(reported.occurrencesInRepository, 0);
  assert.equal(reported.occurrencesInTdsProjectKmz, 0);
  assert.equal(reported.occurrencesInProductionPdfText, 0);
  assert.equal(reported.occurrencesInTdsPricelist, 0);

  // So the link is PARTIAL, never true: spec agrees, enclosure does not.
  assert.equal(reported.linkedToTdsCatalogueCode, "PARTIAL");
  assert.notEqual(reported.linkedToTdsCatalogueCode, true);
  assert.equal(reported.verification, EBC_VERIFICATION.UNKNOWN);
  assert.ok(reported.agreesOn.some((item) => /19 dB tap/.test(item)));
  assert.ok(reported.differsOn.some((item) => /OCC1P/.test(item)));

  assert.equal(TDS_COMMSCOPE_CORRELATION.conclusion, "SAME TAP SPECIFICATION, ENCLOSURE VARIANT UNCONFIRMED");
  assert.match(TDS_COMMSCOPE_CORRELATION.stillNeeded, /photograph/i);
});

test("TDS states a tap loss per splitter size and states no through loss", () => {
  // The figure Node 54 actually needs: 1x4, five ratios.
  assert.equal(tdsTapLossDb(4, "90/10"), 19);
  assert.equal(tdsTapLossDb(4, "85/15"), 17);
  assert.equal(tdsTapLossDb(4, "80/20"), 15);
  assert.equal(tdsTapLossDb(4, "70/30"), 13);
  assert.equal(tdsTapLossDb(4, "60/40"), 11);

  // Tap loss depends on splitter size, so a 1x2 is a different number.
  assert.equal(tdsTapLossDb(2, "90/10"), 15);
  assert.equal(tdsTapLossDb(8, "90/10"), 22);
  // Unstated combinations return null rather than a nearby guess.
  assert.equal(tdsTapLossDb(4, "95/5"), null);
  assert.equal(tdsTapLossDb(16, "90/10"), null);

  // The source states no through loss anywhere.
  assert.equal(TDS_PRICELIST_SOURCE.statesTapLoss, true);
  assert.equal(TDS_PRICELIST_SOURCE.statesThroughLoss, false);
  assert.equal(TDS_PRICELIST_SOURCE.statesMaxInsertionLoss, false);
  assert.equal(TDS_PRICELIST_SOURCE.statesWavelength, false);

  // The constant carries its citation and the part it came from.
  const constant = tdsTapLossConstant(4, "90/10");
  assert.equal(constant.value, 19);
  assert.equal(constant.units, "dB");
  assert.equal(constant.manufacturer, "CommScope");
  assert.equal(constant.model, "OFDC-BG8-S2/6C-4T19");
  assert.equal(constant.verification, EBC_VERIFICATION.TDS_VERIFIED);
  assert.equal(constant.verified, true);
  assert.equal(constant.dataClass, EBC_DATA_CLASS.ENGINEERING_CONSTANT);
  // Wavelength is genuinely unstated and is not invented.
  assert.equal(constant.wavelengthNm, null);
  assert.match(constant.sourceDetail, /4 Drop Tap 19dB/);

  // Source anomalies are recorded, and the family Node 54 uses is clean.
  assert.equal(TDS_1X4_IS_SELF_CONSISTENT, true);
  assert.ok(TDS_PRICELIST_ANOMALIES.every((item) => /1x2/.test(item.unit)));
});

test("the TDS tap figure is applied only when the splitter size is known", () => {
  const base = {
    legId: "TDS", wavelengthNm: 1550, launch: { powerDbm: -8.4 },
    fiber: { attenuationDbPerKm: 0.25, distanceUnit: "km" },
    limits: { receiverMinDbm: -28, engineeringReserveDb: 3 },
    nodes: [{ id: "n1", label: "PCOT", type: "pcot", installedRatio: "90/10", span: {} }],
  };

  // No splitter size recorded: the repository estimate stands, still flagged.
  const unknownSize = calculateLeg(base);
  const unknownNode = findNodeResult(unknownSize, "n1");
  assert.equal(unknownNode.tapInsertionLossDb, 10.5);
  assert.equal(unknownNode.tapVerified, false);
  assert.equal(unknownNode.tapSource, "REPO_ESTIMATE");

  // A 1x4 recorded: the TDS figure is used and marked verified.
  const known = { ...base, nodes: [{ ...base.nodes[0], splitterRatio: 4 }] };
  const knownResult = calculateLeg(known);
  const knownNode = findNodeResult(knownResult, "n1");
  assert.equal(knownNode.tapInsertionLossDb, 19);
  assert.equal(knownNode.tapVerified, true);
  assert.equal(knownNode.tapSource, "TDS_PRICELIST");
  assert.equal(knownNode.portCount, 4);

  // Through loss is never promoted, so the leg stays preliminary either way.
  assert.equal(knownNode.throughVerified, false);
  assert.equal(knownResult.preliminary, true);
  assert.equal(knownResult.dataQuality.headline, "PRELIMINARY — TAP LOSS IS TDS VERIFIED, THROUGH LOSS IS NOT");
  assert.equal(knownResult.dataQuality.tdsVerifiedTapCount, 1);

  // The verified tap and the estimated through are classified separately.
  const tapEntry = knownResult.dataQuality.inputs.find((item) => item.field === "pcot.tapLoss");
  const throughEntry = knownResult.dataQuality.inputs.find((item) => item.field === "pcot.throughLoss");
  assert.equal(tapEntry.dataClass, EBC_DATA_CLASS.ENGINEERING_CONSTANT);
  assert.equal(throughEntry.dataClass, EBC_DATA_CLASS.ESTIMATE);
});

test("Node 54 legs pick up the TDS tap figure because TDS records them as 1x4", () => {
  const leg = buildNode54Leg("S4");
  leg.launch.powerDbm = -8.4;
  leg.limits = { receiverMinDbm: -28, engineeringReserveDb: 3 };
  leg.fiber = { attenuationDbPerKm: 0.35, distanceUnit: "ft" };
  leg.nodes = leg.nodes.map((node) => ({ ...node, installedRatio: node.designedRatio }));

  const result = calculateLeg(leg);
  assert.equal(result.ok, true);
  assert.deepEqual(result.nodes.map((node) => node.portCount), [4, 4, 4, 4]);
  assert.deepEqual(result.nodes.map((node) => node.tapInsertionLossDb), [19, 17, 15, 13]);
  assert.ok(result.nodes.every((node) => node.tapSource === "TDS_PRICELIST"));
  assert.equal(result.dataQuality.tdsVerifiedTapCount, 4);
});

test("candidate limits and unlocated tables are recorded but never applied", () => {
  const failThreshold = EBC_CANDIDATE_LIMITS.find((item) => item.key === "limits.failThresholdDbm.fieldNavKmz");
  assert.equal(failThreshold.value, -24);
  assert.equal(failThreshold.units, "dBm");
  assert.equal(failThreshold.verified, false);
  assert.equal(failThreshold.verification, EBC_VERIFICATION.UNKNOWN);

  // A leg with no configured limits still refuses to produce a margin, i.e.
  // the candidate has not leaked into the calculator as a default.
  const leg = {
    legId: "X", wavelengthNm: 1550, launch: { powerDbm: -8 },
    fiber: { attenuationDbPerKm: 0.25, distanceUnit: "km" }, limits: {},
    nodes: [{ id: "n1", label: "PCOT", type: "pcot", installedRatio: "90/10", span: {} }],
  };
  const result = calculateLeg(leg);
  assert.equal(findNodeResult(result, "n1").marginDb, null);
  assert.equal(result.ok, false);

  // The reported alternate loss table is preserved, flagged, and unused.
  assert.equal(EBC_REPORTED_ALTERNATE_LOSS_TABLE.status, "UNLOCATED");
  assert.equal(EBC_REPORTED_ALTERNATE_LOSS_TABLE.values["90/10"].tapLossDb, 11.2);
  assert.equal(DEFAULT_PCOT_SPECS["90/10"].nominalTapLossDb, 10.5);
  assert.notEqual(
    EBC_REPORTED_ALTERNATE_LOSS_TABLE.values["90/10"].tapLossDb,
    DEFAULT_PCOT_SPECS["90/10"].nominalTapLossDb,
  );

  // Everything the EBC still needs is declared with a null value, not defaulted.
  for (const constant of EBC_REQUIRED_UNKNOWN_CONSTANTS){
    assert.equal(constant.value, null, constant.key + " must not carry an invented value");
    assert.equal(constant.available, false);
    assert.equal(constant.verified, false);
  }
});

/* ------------------------------------------------------------------ *
 * Data-quality classification
 * ------------------------------------------------------------------ */

function estimateLeg(){
  return {
    legId: "DQ", wavelengthNm: 1550,
    launch: { powerDbm: -8.4 },
    fiber: { attenuationDbPerKm: 0.25, distanceUnit: "ft" },
    defaults: { spliceLossDb: 0.1, connectorLossDb: 0.25 },
    limits: { receiverMinDbm: -28, engineeringReserveDb: 3 },
    nodes: [{
      id: "n1", label: "PCOT 2058", type: "pcot",
      designedRatio: "90/10", installedRatio: "90/10",
      span: { distance: 437, distanceUnit: "ft", distanceSource: "TDS_CABLE_PLACEMENT_FOOTAGE" },
    }],
  };
}

test("a result built on estimated loss is reported as preliminary", () => {
  const result = calculateLeg(estimateLeg());
  assert.equal(result.ok, true);
  assert.equal(result.preliminary, true);
  assert.equal(result.dataQuality.headline, "PRELIMINARY — USING UNVERIFIED PCOT LOSS DATA");
  assert.match(result.dataQuality.reasons.join(" "), /unverified estimate/);
  assert.deepEqual(result.dataQuality.unverifiedRatios, ["90/10"]);
});

test("design, field and estimate inputs are classified separately and never merged", () => {
  const leg = estimateLeg();
  leg.nodes[0].measured = { inputDbm: -8.5, throughDbm: -9.3, tapDbm: -19.4, wavelengthNm: 1550 };
  const result = calculateLeg(leg, { mode: "field" });

  const classes = result.dataQuality.inputs.map((item) => item.dataClass);
  assert.ok(classes.includes(EBC_DATA_CLASS.DESIGN_DATA));
  assert.ok(classes.includes(EBC_DATA_CLASS.FIELD_DATA));
  assert.ok(classes.includes(EBC_DATA_CLASS.ESTIMATE));

  const design = result.dataQuality.inputs.find((item) => item.dataClass === EBC_DATA_CLASS.DESIGN_DATA);
  assert.equal(design.detail, "TDS_CABLE_PLACEMENT_FOOTAGE");
  const estimate = result.dataQuality.inputs.find((item) => item.dataClass === EBC_DATA_CLASS.ESTIMATE);
  assert.match(estimate.detail, /Repository estimate/);

  assert.equal(result.dataQuality.counts.designData, 1);
  assert.equal(result.dataQuality.counts.fieldData, 1);
  assert.equal(result.dataQuality.counts.engineeringConstants, 0);
});

test("a span distance the technician typed is not counted as design data", () => {
  const leg = estimateLeg();
  leg.nodes[0].span = { distance: 500, distanceUnit: "ft" };
  const result = calculateLeg(leg);
  const entry = result.dataQuality.inputs.find((item) => item.field === "span.distance");
  assert.equal(entry.dataClass, EBC_DATA_CLASS.ESTIMATE);
  assert.match(entry.detail, /no design source recorded/);
});

test("verified specifications clear the preliminary flag", () => {
  const specs = configurePcotSpec(DEFAULT_PCOT_SPECS, "90/10", {
    nominalThroughLossDb: 0.8, nominalTapLossDb: 11.2,
    maxThroughInsertionLossDb: 1.1, maxTapInsertionLossDb: 11.9,
    manufacturer: "Example Optical", model: "HxFO(1x4)PCOT(90/10)MO",
    wavelengthNm: 1550, reference: "Example TDS rev C",
    verification: EBC_VERIFICATION.MANUFACTURER_VERIFIED, verified: true,
  });
  const result = calculateLeg(estimateLeg(), { specs });
  assert.equal(result.preliminary, false);
  assert.equal(result.dataQuality.headline, "ENGINEERING APPROVED INPUTS");
  assert.equal(result.dataQuality.counts.engineeringConstants, 1);
  assert.equal(result.specsVerified, true);
});

/* ------------------------------------------------------------------ *
 * Generic TDS import
 * ------------------------------------------------------------------ */

/** A miniature TDS export in the real shape: two taps, a CP link and a cable. */
const FIXTURE_KML = `<Placemark><description><![CDATA[
<table><tr><td>Network Device Name</td><td>TestNetworkDevice-1</td></tr>
<tr><td>Material Unit</td><td>HxFO(1x4)PCOT(90/10)MO</td></tr>
<tr><td>Connectivity Point Name</td><td>TestConnectivityPoint-100</td></tr>
<tr><td>Splitter Path</td><td>9000AA,P0009,S1:L1</td></tr>
<tr><td>Splitter Order</td><td>0</td></tr><tr><td>Splitter Ratio</td><td>4</td></tr>
<tr><td>Optical Tap Ratio</td><td>90/10</td></tr>
<tr><td>Collective Tap Loss Value At Splitter</td><td>&lt;Null&gt;</td></tr>
<tr><td>Project</td><td>9000AA_01</td></tr></table>]]></description>
<Point><coordinates>-105.5,33.5,0</coordinates></Point></Placemark>
<Placemark><description><![CDATA[
<table><tr><td>Network Device Name</td><td>TestNetworkDevice-2</td></tr>
<tr><td>Material Unit</td><td>HxFO(1x4)PCOT(70/30)MO</td></tr>
<tr><td>Connectivity Point Name</td><td>TestConnectivityPoint-101</td></tr>
<tr><td>Splitter Path</td><td>9000AA,P0009,S1:L2</td></tr>
<tr><td>Splitter Order</td><td>0</td></tr><tr><td>Splitter Ratio</td><td>4</td></tr>
<tr><td>Optical Tap Ratio</td><td>70/30</td></tr>
<tr><td>Collective Tap Loss Value At Splitter</td><td>&lt;Null&gt;</td></tr>
<tr><td>Project</td><td>9000AA_01</td></tr></table>]]></description>
<Point><coordinates>-105.6,33.6,0</coordinates></Point></Placemark>
<Placemark><description><![CDATA[
<table><tr><td>Connectivity Point Name</td><td>TestConnectivityPoint-100</td></tr>
<tr><td>Network Point Connectivity Point Is Located At</td><td>TestNetworkPoint-5001</td></tr></table>]]></description></Placemark>
<Placemark><description><![CDATA[
<table><tr><td>Connectivity Point Name</td><td>TestConnectivityPoint-101</td></tr>
<tr><td>Network Point Connectivity Point Is Located At</td><td>TestNetworkPoint-5002</td></tr></table>]]></description></Placemark>
<Placemark><description><![CDATA[
<table><tr><td>Connectivity Point Name</td><td>TestConnectivityPoint-099</td></tr>
<tr><td>Network Point Connectivity Point Is Located At</td><td>TestNetworkPoint-4000</td></tr></table>]]></description></Placemark>
<Placemark><description><![CDATA[
<table><tr><td>Cable Name</td><td>TestCable-1</td></tr>
<tr><td>Connectivity Point ID Where Cable Starts</td><td>TestConnectivityPoint-099</td></tr>
<tr><td>Connectivity Point ID Where Cable Ends</td><td>TestConnectivityPoint-100</td></tr>
<tr><td>Labor or Labor/Material Amount</td><td>410</td></tr></table>]]></description></Placemark>
<Placemark><description><![CDATA[
<table><tr><td>Cable Name</td><td>TestCable-2</td></tr>
<tr><td>Connectivity Point ID Where Cable Starts</td><td>TestConnectivityPoint-100</td></tr>
<tr><td>Connectivity Point ID Where Cable Ends</td><td>TestConnectivityPoint-101</td></tr>
<tr><td>Labor or Labor/Material Amount</td><td>250</td></tr></table>]]></description></Placemark>`;

test("TDS helpers normalise identifiers, null markers and splitter paths", () => {
  assert.equal(tdsIdNumber("RuidosoConnectivityPoint-12917"), "12917");
  assert.equal(tdsIdNumber(""), "");
  assert.equal(tdsValue("&lt;Null&gt;"), null);
  assert.equal(tdsValue("N/A"), null);
  assert.equal(tdsValue("  90/10 "), "90/10");

  assert.deepEqual(parseSplitterPath("1635CA,P0002,S4:L1"), {
    node: "1635CA", pon: "P0002", branch: "S4", position: "L1", order: 1, key: "1635CA|P0002|S4",
  });
  assert.equal(parseSplitterPath("nonsense"), null);
});

test("the importer extracts a cascade from any project without knowing it", () => {
  const design = extractTdsDesign(FIXTURE_KML);
  assert.equal(design.placemarkCount, 7);
  assert.deepEqual(design.projects, ["9000AA_01"]);
  assert.deepEqual(design.pons, ["9000AA/P0009"]);
  assert.equal(design.legs.length, 1);

  const leg = design.legs[0];
  assert.equal(leg.key, "9000AA|P0009|S1");
  assert.deepEqual(leg.nodes.map((node) => node.position), ["L1", "L2"]);
  assert.deepEqual(leg.nodes.map((node) => node.np), ["5001", "5002"]);
  assert.deepEqual(leg.nodes.map((node) => node.tapRatio), ["90/10", "70/30"]);
  // Span footage comes from the direct cable between consecutive taps.
  assert.deepEqual(leg.nodes.map((node) => node.spanFeetFromPrevious), [410, 250]);
  // The head is discovered, not configured: the neighbour that is not a tap.
  assert.equal(leg.head.cp, "099");
  assert.equal(leg.head.np, "4000");
  assert.equal(leg.positionsSequential, true);
  assert.equal(design.warnings.length, 0);
});

test("the importer reports absent optical loss instead of inferring it", () => {
  const design = extractTdsDesign(FIXTURE_KML);
  assert.equal(design.containsInsertionLoss, false);
  assert.equal(design.lossFieldName, "Collective Tap Loss Value At Splitter");
  assert.deepEqual(design.lossFieldSummary, [{ value: "<Null>", count: 2 }]);

  // A leg converted for the engine carries no invented constants at all.
  const leg = tdsLegToEbcLeg(design.legs[0]);
  assert.equal(leg.launch.powerDbm, null);
  assert.equal(leg.limits.receiverMinDbm, null);
  assert.equal(leg.limits.engineeringReserveDb, null);
  assert.equal(leg.fiber.attenuationDbPerKm, null);
  assert.equal(leg.defaults.spliceLossDb, null);
  assert.equal(leg.nodes[0].installedRatio, null);
  assert.equal(leg.nodes[0].designedRatio, "90/10");
  assert.equal(leg.nodes[0].span.distance, 410);
  assert.equal(leg.nodes[0].span.distanceSource, "TDS_CABLE_PLACEMENT_FOOTAGE");

  // And it drives the engine, which then asks for what is missing.
  const result = calculateLeg(leg);
  assert.equal(result.ok, false);
  assert.match(result.validation.missingSummary.join(" "), /Upstream launch power is missing/);
});

test("the importer warns rather than guessing when the design is incomplete", () => {
  // Remove the upstream cable so the head cannot be identified.
  const noHead = FIXTURE_KML.replace(/<Placemark><description><!\[CDATA\[\s*<table><tr><td>Cable Name<\/td><td>TestCable-1[\s\S]*?<\/Placemark>/, "");
  const design = extractTdsDesign(noHead);
  assert.equal(design.legs[0].head, null);
  assert.equal(design.legs[0].nodes[0].spanFeetFromPrevious, null);
  assert.match(design.warnings.join(" "), /could not identify a single upstream feed/);

  // A gap in the L-positions is reported, not silently renumbered.
  const gapped = FIXTURE_KML.replace("9000AA,P0009,S1:L2", "9000AA,P0009,S1:L3");
  const gappedDesign = extractTdsDesign(gapped);
  assert.equal(gappedDesign.legs[0].positionsSequential, false);
  assert.match(gappedDesign.warnings.join(" "), /positions are not sequential/);
});

test("importer filters select a single project, node or PON", () => {
  assert.equal(extractTdsDesign(FIXTURE_KML, { pon: "P0009" }).devices.length, 2);
  assert.equal(extractTdsDesign(FIXTURE_KML, { pon: "P9999" }).devices.length, 0);
  assert.equal(extractTdsDesign(FIXTURE_KML, { node: "9000AA" }).legs.length, 1);
  assert.equal(extractTdsDesign(FIXTURE_KML, { project: "nope" }).legs.length, 0);
});

/* ------------------------------------------------------------------ *
 * The EBC screen must not present an estimate as approved, and must not
 * strand content off-screen on a phone.
 * ------------------------------------------------------------------ */

test("the EBC screen states the preliminary caveat on every result surface", () => {
  const appSource = readFileSync(new URL("../app.js", import.meta.url), "utf8");

  // The headline comes from the engine, so screen and engine cannot drift.
  assert.match(appSource, /renderEbcPreliminaryBanner/);
  assert.match(appSource, /result\.dataQuality\.headline/);
  assert.match(appSource, /Do not submit as an approved engineering calculation/);

  // Recommendation and What-If are results too and carry their own chip.
  const recommendation = appSource.slice(appSource.indexOf("function renderEbcRecommendation"));
  assert.match(recommendation.slice(0, 2000), /ebc-prelim-chip/);
  const whatIf = appSource.slice(appSource.indexOf("function renderEbcWhatIfPanel"));
  assert.match(whatIf.slice(0, 2000), /ebc-prelim-chip/);

  // The data-quality panel separates the four classes explicitly.
  for (const dataClass of ["FIELD_DATA", "DESIGN_DATA", "ENGINEERING_CONSTANT", "ESTIMATE"]){
    assert.match(appSource, new RegExp("EBC_DATA_CLASS\\." + dataClass));
  }
});

test("every EBC table is inside a horizontal scroll container", () => {
  // A table that is not wrapped stretches its CSS grid track and pushes the
  // whole card off a 375px screen, which is exactly the width used in the field.
  const appSource = readFileSync(new URL("../app.js", import.meta.url), "utf8");
  const tables = [...appSource.matchAll(/<table class="ebc-compare[^"]*"/g)];
  assert.ok(tables.length >= 3, "expected the field, what-if and specification tables");
  for (const match of tables){
    const preceding = appSource.slice(Math.max(0, match.index - 400), match.index);
    assert.match(
      preceding, /ebc-table-scroll/,
      "a table at index " + match.index + " is not wrapped in .ebc-table-scroll",
    );
  }

  const stylesSource = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  assert.match(stylesSource, /\.ebc-table-scroll\{[^}]*overflow-x:\s*auto/);
  // Grid children must opt out of min-width:auto or a wide child stretches them.
  assert.match(stylesSource, /\.ebc-shell > \*[\s\S]{0,220}min-width:\s*0/);
});

test("placemark parsing also reads KML Data elements used by analysis overlays", () => {
  const overlay = `<Placemark><ExtendedData>
    <Data name="NetworkPoint"><value>NP 1713</value></Data>
    <Data name="WeakestReading_dBm"><value>-56.21</value></Data>
    <Data name="FailThreshold_dBm"><value>-24.00</value></Data>
    <Data name="Status"><value>FAIL</value></Data>
  </ExtendedData><Point><coordinates>-105.67,33.36,0</coordinates></Point></Placemark>`;
  const [mark] = parseTdsKml(overlay);
  assert.equal(mark.fields.NetworkPoint, "NP 1713");
  assert.equal(mark.fields.FailThreshold_dBm, "-24.00");
  assert.equal(mark.fields.Status, "FAIL");
  assert.deepEqual(mark.point, { lat: 33.36, lng: -105.67 });
});
