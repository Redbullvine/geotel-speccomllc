/**
 * EBC — Node 54 design record extracted from the TDS project export.
 *
 * SOURCE: Project.kmz (TDS Ruidoso project export), doc.kml, project 1635CA_02,
 * PON P0002. Extracted from the NETWORK DEVICE records carrying
 * "Splitter Path" / "Optical Tap Ratio" / "Material Unit", joined to
 * CONNECTIVITY POINT records via "Connectivity Point Name" and to CABLE records
 * via "Connectivity Point ID Where Cable Starts/Ends".
 *
 * Cascade order is the TDS Splitter Path position (S4:L1, S4:L2, ...), not an
 * assumption. It was cross-checked three ways and agreed every time:
 *   1. the L1..L5 position in the TDS Splitter Path
 *   2. the app's own NODE54_SCHEMATIC_SEGMENTS record
 *   3. consecutive PCOTs being joined by a single direct TDS cable
 *
 * spanFeet is the TDS cable placement quantity ("Labor or Labor/Material
 * Amount") for the cable joining the two connectivity points. It is design
 * footage for the placed cable, NOT a measured sheath length and NOT an OTDR
 * distance. It excludes slack, coils and splice-case service loops, so it is a
 * lower bound on real fiber length.
 *
 * WHAT THIS FILE DOES NOT CONTAIN: optical insertion loss. The KMZ carries one
 * loss-shaped field, "Collective Tap Loss Value At Splitter", and it is <Null>
 * on 494 of the 551 records that have the field and 0 on the other 57; among
 * the 495 actual tap devices carrying a Splitter Path, 494 are <Null> and 1 is
 * 0. No non-zero dB value exists anywhere in the export, so the insertion-loss
 * specification in pcotSpecs.mjs remains UNVERIFIED and still needs the
 * manufacturer data sheet for the part numbers recorded below.
 */

export const NODE54_TDS_SOURCE = Object.freeze({
  file: "Project.kmz",
  document: "doc.kml",
  project: "1635CA_02",
  node: "1635CA",
  pon: "P0002",
  market: "Ruidoso",
  extractedFields: Object.freeze([
    "Splitter Path", "Splitter Order", "Optical Tap Ratio", "Material Unit",
    "Splitter Ratio", "Connectivity Point Name",
    "Network Point Connectivity Point Is Located At",
    "Connectivity Point ID Where Cable Starts", "Connectivity Point ID Where Cable Ends",
    "Labor or Labor/Material Amount",
  ]),
  containsInsertionLoss: false,
  lossFieldChecked: "Collective Tap Loss Value At Splitter",
  lossFieldResult: "No optical value anywhere. 551 records carry the field: 494 <Null>, 57 zero. Among the 495 tap devices with a Splitter Path: 494 <Null>, 1 zero. No non-zero dB value exists in the export.",
});

export const NODE54_TDS_LEGS = Object.freeze({
  S3: Object.freeze({
    branch: "S3",
    head: Object.freeze({ np: "1702", cp: "13817" }),
    nodes: Object.freeze([
      Object.freeze({ position: "L1", np: "12001", cp: "12917", ratio: "90/10", materialUnit: "HxFO(1x4)PCOT(90/10)MO", splitterRatio: 4, spanFeetFromPrevious: 593, lat: 33.36415215, lng: -105.67364507 }),
      Object.freeze({ position: "L2", np: "1713", cp: "12918", ratio: "85/15", materialUnit: "HxFO(1x4)PCOT(85/15)MO", splitterRatio: 4, spanFeetFromPrevious: 356, lat: 33.3638957, lng: -105.67252146 }),
      Object.freeze({ position: "L3", np: "2066", cp: "13103", ratio: "80/20", materialUnit: "HxFO(1x4)PCOT(80/20)MO", splitterRatio: 4, spanFeetFromPrevious: 578, lat: 33.36356356, lng: -105.67345375 }),
      Object.freeze({ position: "L4", np: "1708", cp: "12919", ratio: "70/30", materialUnit: "HxFO(1x4)PCOT(70/30)MO", splitterRatio: 4, spanFeetFromPrevious: 192, lat: 33.363291, lng: -105.67291533 }),
      Object.freeze({ position: "L5", np: "2067", cp: "12920", ratio: "60/40", materialUnit: "HxFO(1x4)PCOT(60/40)MO", splitterRatio: 4, spanFeetFromPrevious: 219, lat: 33.36328382, lng: -105.67219732 }),
    ]),
  }),
  S4: Object.freeze({
    branch: "S4",
    head: Object.freeze({ np: "1702", cp: "13817" }),
    nodes: Object.freeze([
      Object.freeze({ position: "L1", np: "2058", cp: "12913", ratio: "90/10", materialUnit: "HxFO(1x4)PCOT(90/10)MO", splitterRatio: 4, spanFeetFromPrevious: 437, lat: 33.3645804, lng: -105.67366874 }),
      Object.freeze({ position: "L2", np: "2060", cp: "12914", ratio: "85/15", materialUnit: "HxFO(1x4)PCOT(85/15)MO", splitterRatio: 4, spanFeetFromPrevious: 240, lat: 33.36474339, lng: -105.6729071 }),
      Object.freeze({ position: "L3", np: "2062", cp: "12915", ratio: "80/20", materialUnit: "HxFO(1x4)PCOT(80/20)MO", splitterRatio: 4, spanFeetFromPrevious: 160, lat: 33.3647965, lng: -105.6723864 }),
      Object.freeze({ position: "L4", np: "1715", cp: "12916", ratio: "70/30", materialUnit: "HxFO(1x4)PCOT(70/30)MO", splitterRatio: 4, spanFeetFromPrevious: 191, lat: 33.36437846, lng: -105.67200812 }),
    ]),
  }),
  S5: Object.freeze({
    branch: "S5",
    head: Object.freeze({ np: "1702", cp: "13817" }),
    nodes: Object.freeze([
      Object.freeze({ position: "L1", np: "2056", cp: "11752", ratio: "90/10", materialUnit: "HxFO(1x4)PCOT(90/10)MO", splitterRatio: 4, spanFeetFromPrevious: 207, lat: 33.36496026, lng: -105.67454957 }),
      Object.freeze({ position: "L2", np: "1706", cp: "11753", ratio: "85/15", materialUnit: "HxFO(1x4)PCOT(85/15)MO", splitterRatio: 4, spanFeetFromPrevious: 198, lat: 33.36441525, lng: -105.67455141 }),
      Object.freeze({ position: "L3", np: "1699", cp: "11754", ratio: "80/20", materialUnit: "HxFO(1x4)PCOT(80/20)MO", splitterRatio: 4, spanFeetFromPrevious: 157, lat: 33.36398401, lng: -105.67454957 }),
      Object.freeze({ position: "L4", np: "2054", cp: "11755", ratio: "70/30", materialUnit: "HxFO(1x4)PCOT(70/30)MO", splitterRatio: 4, spanFeetFromPrevious: 168, lat: 33.36352248, lng: -105.67456394 }),
      Object.freeze({ position: "L5", np: "1704", cp: "11931", ratio: "60/40", materialUnit: "HxFO(1x4)PCOT(60/40)MO", splitterRatio: 4, spanFeetFromPrevious: 168, lat: 33.36306189, lng: -105.67452594 }),
    ]),
  }),
  S8: Object.freeze({
    branch: "S8",
    head: Object.freeze({ np: "2015", cp: "12401" }),
    nodes: Object.freeze([
      Object.freeze({ position: "L1", np: "2017", cp: "13803", ratio: "90/10", materialUnit: "HxFO(1x4)PCOT(90/10)MO", splitterRatio: 4, spanFeetFromPrevious: 216, lat: 33.36716467, lng: -105.67403105 }),
      Object.freeze({ position: "L2", np: "2103", cp: "13804", ratio: "90/10", materialUnit: "HxFO(1x4)PCOT(90/10)MO", splitterRatio: 4, spanFeetFromPrevious: 193, lat: 33.36714537, lng: -105.67466129 }),
      Object.freeze({ position: "L3", np: "2019", cp: "13704", ratio: "85/15", materialUnit: "HxFO(1x4)PCOT(85/15)MO", splitterRatio: 4, spanFeetFromPrevious: 216, lat: 33.3674566, lng: -105.6749455 }),
    ]),
  }),
});

/** Distinct TDS part numbers in use on Node 54, keyed by tap ratio. */
export const NODE54_TDS_PART_NUMBERS = Object.freeze({
  "60/40": "HxFO(1x4)PCOT(60/40)MO",
  "70/30": "HxFO(1x4)PCOT(70/30)MO",
  "80/20": "HxFO(1x4)PCOT(80/20)MO",
  "85/15": "HxFO(1x4)PCOT(85/15)MO",
  "90/10": "HxFO(1x4)PCOT(90/10)MO",
});

/** Look up the TDS design record for a PCOT by its NP identifier. */
export function findTdsPcot(np){
  const target = String(np || "").trim();
  for (const leg of Object.values(NODE54_TDS_LEGS)){
    const node = leg.nodes.find((item) => item.np === target || item.cp === target);
    if (node) return { branch: leg.branch, head: leg.head, node };
  }
  return null;
}
