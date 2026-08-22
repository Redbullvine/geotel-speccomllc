/**
 * EBC — Node 54 leg model.
 *
 * The cascade order here is DERIVED from NODE54_SCHEMATIC_SEGMENTS in
 * services/node54Diagnostics.mjs, which is the project's own documented
 * endpoint-to-endpoint record. It is not a guess and not a hard-coded sequence
 * typed in from memory: change the segments and these legs change with them.
 *
 * Designed ratios come from NODE54_STOPS.expectedRatio, which the existing test
 * suite pins to the original 1/9-1/17 production record
 * (production_1_9_2026 - 1_17_2026.pdf, NODE54_1635CA_02 records carrying
 * HxFO(1X4)PCOT(ratio)MO). Those ratios are therefore design evidence.
 *
 * Span footage, TDS part numbers, connectivity-point identifiers and the tap
 * ratio for every location come from the TDS project export via
 * ./node54TdsDesign.mjs. The TDS Splitter Path order, this file's derived order
 * and the "consecutive PCOTs share one direct cable" test all agree, so the
 * cascade below is corroborated three independent ways.
 *
 * What is deliberately NOT supplied:
 *   - splice and connector counts per span: not recorded in either source
 *   - launch power at the head of each leg: must be measured or supplied
 *   - fiber attenuation coefficient: not recorded in either source
 *   - PCOT insertion loss: the TDS export contains no dB value for any device
 *   - the meaning of the historical LOW/HIGH readings: explicitly unconfirmed
 *     in the source, so they are carried as history and never loaded into the
 *     calculator as an input or through reading.
 *
 * The EBC reports each of these as missing rather than inventing a value.
 */

import {
  NODE54_HISTORY,
  NODE54_IMPORTED_EVIDENCE,
  NODE54_PROJECT_ID,
  NODE54_PROJECT_NAME,
  NODE54_SCHEMATIC_SEGMENTS,
  NODE54_STOPS,
} from "../node54Diagnostics.mjs";
import { NODE54_TDS_LEGS, NODE54_TDS_SOURCE, findTdsPcot } from "./node54TdsDesign.mjs";

/** Branch portion of a documented path label: "S6:T2/F42" -> "S6:T2". */
function branchOf(pathToken){
  return String(pathToken || "").trim().split("/")[0].split(" ")[0].trim();
}

/** Every branch a documented segment carries. */
function segmentBranches(segment){
  return String(segment?.paths || "").split("·").map(branchOf).filter(Boolean);
}

/**
 * A segment belongs to a branch when the two labels are the same branch or one
 * is a sub-branch of the other. "S6" carries "S6:T3"; "S6:T2" does not.
 */
function segmentCarriesBranch(segment, branchKey){
  const key = String(branchKey || "").trim();
  return segmentBranches(segment).some((branch) =>
    branch === key || key.startsWith(branch + ":") || branch.startsWith(key + ":"));
}

/** Walk the documented segments for a branch into an ordered chain of stop ids. */
export function deriveLegPath(branchKey){
  const segments = NODE54_SCHEMATIC_SEGMENTS.filter((segment) => segmentCarriesBranch(segment, branchKey));
  if (!segments.length) return [];

  const targets = new Set(segments.map((segment) => segment.to));
  const heads = segments.map((segment) => segment.from).filter((from) => !targets.has(from));
  const start = heads[0] || segments[0].from;

  const order = [start];
  const visited = new Set([start]);
  let cursor = start;
  while (true){
    const next = segments.find((segment) => segment.from === cursor && !visited.has(segment.to));
    if (!next) break;
    order.push(next.to);
    visited.add(next.to);
    cursor = next.to;
  }
  return order;
}

const stopById = new Map(NODE54_STOPS.map((stop) => [stop.id, stop]));

function historicalFor(stop){
  const readings = (stop.steps || []).map((step) => step.reference).filter((value) => value !== null && value !== undefined);
  if (!readings.length) return null;
  const lines = (NODE54_HISTORY[branchOf((stop.steps || [])[0]?.path || "")] || [])
    .filter((line) => line.includes("NP" + stop.np));
  return Object.freeze({
    values: Object.freeze(readings),
    lowDbm: readings.length > 1 ? readings[0] : null,
    highDbm: readings.length > 1 ? readings[1] : null,
    singleDbm: readings.length === 1 ? readings[0] : null,
    lines: Object.freeze(lines),
    note: "Historical workbook values. The source records that the LOW/HIGH designation is not confirmed, so they are not loaded as input, through or tap readings.",
  });
}

function nodeTypeFor(stop){
  if (stop.expectedRatio) return "pcot";
  const device = String(stop.device || "").toLowerCase();
  if (device.includes("splitter")) return "splitter";
  if (device.includes("breakout") || device.includes("enclosure")) return "breakout";
  return "terminal";
}

/**
 * Build one EBC leg for a Node 54 branch.
 *
 * Locations upstream of the first PCOT (the P0002 splitter and the CP13817
 * breakout enclosure) are reported as `upstreamPath` rather than as budget
 * nodes, because no loss figure exists for either of them in this repository
 * and modelling them at 0 dB would understate the budget.
 */
export function buildNode54Leg(branchKey, overrides = {}){
  const path = deriveLegPath(branchKey);
  const stops = path.map((id) => stopById.get(id)).filter(Boolean);
  const firstPcotIndex = stops.findIndex((stop) => nodeTypeFor(stop) === "pcot");

  const upstreamStops = firstPcotIndex < 0 ? stops : stops.slice(0, firstPcotIndex);
  const budgetStops = firstPcotIndex < 0 ? [] : stops.slice(firstPcotIndex);

  const head = upstreamStops.length ? upstreamStops[upstreamStops.length - 1] : null;
  const firstBudget = budgetStops[0] || null;
  const launchStep = head && firstBudget
    ? (head.steps || []).find((step) => step.nextStopId === firstBudget.id) || null
    : null;

  const nodes = budgetStops.map((stop) => {
    const tds = findTdsPcot(stop.np);
    const tdsNode = tds ? tds.node : null;
    return Object.freeze({
    id: stop.id,
    label: "PCOT " + stop.np,
    np: stop.np,
    cp: stop.cp || (tdsNode ? tdsNode.cp : ""),
    // A location the app carried without a ratio is still a PCOT if TDS says so.
    type: (stop.expectedRatio || tdsNode) ? "pcot" : "terminal",
    device: stop.device,
    // TDS is the design of record. Where the app's imported production code and
    // the TDS export disagree, both are surfaced rather than silently merged.
    designedRatio: (tdsNode ? tdsNode.ratio : null) || stop.expectedRatio || null,
    designedRatioSource: tdsNode ? "TDS_PROJECT_EXPORT" : (stop.expectedRatio ? "IMPORTED_PRODUCTION_CODE" : null),
    importedProductionCodeRatio: stop.expectedRatio || null,
    tdsPosition: tdsNode ? tdsNode.position : null,
    partNumber: tdsNode ? tdsNode.materialUnit : null,
    splitterRatio: tdsNode ? tdsNode.splitterRatio : null,
    designCoords: tdsNode ? Object.freeze({ lat: tdsNode.lat, lng: tdsNode.lng }) : null,
    // Never pre-filled from the design. An installed ratio is a field
    // observation and stays empty until somebody confirms the label.
    installedRatio: null,
    span: Object.freeze({
      // TDS cable placement footage: design footage for the placed cable, not a
      // measured sheath length. Slack and service loops are not included.
      distance: tdsNode && tdsNode.spanFeetFromPrevious !== null ? tdsNode.spanFeetFromPrevious : null,
      distanceUnit: tdsNode && tdsNode.spanFeetFromPrevious !== null ? "ft" : null,
      distanceSource: tdsNode && tdsNode.spanFeetFromPrevious !== null ? "TDS_CABLE_PLACEMENT_FOOTAGE" : null,
      spliceCount: null,
      connectorCount: null,
    }),
    measured: null,
    historical: historicalFor(stop),
    importedEvidence: NODE54_IMPORTED_EVIDENCE[stop.np] || null,
    siteTerms: stop.siteTerms || [],
    pon: stop.pon,
    why: stop.why,
    details: stop.details,
    });
  });

  return {
    legId: branchKey,
    label: "Node 54 · " + branchKey,
    projectId: NODE54_PROJECT_ID,
    projectName: NODE54_PROJECT_NAME,
    nodeName: "Node 54",
    pon: "P0002",
    wavelengthNm: 1550,
    launch: {
      powerDbm: null,
      provenance: null,
      reference: launchStep
        ? "Measure at " + (head ? head.title : "the head of this leg") + " — " + launchStep.label
        : "No documented launch reference for this branch. Supply the measured power at the head of the leg.",
      referenceStopId: head ? head.id : "",
      referenceStepId: launchStep ? launchStep.id : "",
    },
    fiber: { attenuationDbPerKm: null, attenuationDbPerMile: null, distanceUnit: "ft" },
    defaults: { spliceLossDb: null, connectorLossDb: null },
    limits: { receiverMinDbm: null, receiverMaxDbm: null, engineeringReserveDb: null },
    upstreamPath: Object.freeze(upstreamStops.map((stop) => Object.freeze({
      id: stop.id, label: stop.title, np: stop.np, cp: stop.cp || "",
      device: stop.device, type: nodeTypeFor(stop),
      note: "Documented upstream location. No insertion-loss figure for this device exists in the project data, so it is not budgeted.",
    }))),
    nodes,
    dataGaps: Object.freeze(buildDataGaps(nodes)),
    source: "Cascade order, tap ratios, part numbers and span footage from the TDS project export (" + NODE54_TDS_SOURCE.file + ", project " + NODE54_TDS_SOURCE.project + " / " + NODE54_TDS_SOURCE.pon + "), cross-checked against NODE54_SCHEMATIC_SEGMENTS and NODE54_STOPS in services/node54Diagnostics.mjs.",
    tdsSource: NODE54_TDS_SOURCE,
    ...overrides,
  };
}

function buildDataGaps(nodes){
  const gaps = [];
  const withoutSpan = nodes.filter((node) => node.span.distance === null).map((node) => node.label);
  if (withoutSpan.length){
    gaps.push("No TDS cable footage was found for " + withoutSpan.join(", ") + ", so fiber loss into those locations is counted as 0 dB.");
  }
  if (nodes.length){
    gaps.push("Span distances are TDS cable placement footage, not measured sheath length. Slack, coils and splice-case service loops are not included, so the real fiber run is longer and the predicted power downstream is slightly optimistic.");
    gaps.push("Splice and connector counts per span are not recorded in the project or the TDS export, so those losses are counted as 0 dB.");
    gaps.push("No fiber attenuation coefficient is recorded in either source; it must be entered before span loss can be calculated.");
  }
  gaps.push("PCOT insertion loss is absent from the TDS export. The only loss-shaped field in it, 'Collective Tap Loss Value At Splitter', is null or zero on every device, so the loss values in use remain UNVERIFIED estimates.");
  gaps.push("Launch power at the head of this leg is not stored and must be measured or entered.");
  gaps.push("Engineering limits (receiver minimum, receiver maximum, engineering reserve) are not stored in the project and must be configured.");
  const conflicts = nodes.filter((node) => node.importedProductionCodeRatio && node.designedRatio && node.importedProductionCodeRatio !== node.designedRatio);
  if (conflicts.length){
    gaps.push("TDS and the imported production code disagree at " + conflicts.map((node) => node.label + " (TDS " + node.designedRatio + " vs code " + node.importedProductionCodeRatio + ")").join(", ") + ". The TDS design of record is being used.");
  }
  const unconfirmed = nodes.filter((node) => node.historical).map((node) => node.label);
  if (unconfirmed.length){
    gaps.push("Historical readings exist for " + unconfirmed.join(", ") + " but the source states the LOW/HIGH designation is unconfirmed, so they are not used as input/through/tap values.");
  }
  return gaps;
}

/** Branch keys the documented segments actually support, longest chain first. */
export const NODE54_BRANCH_KEYS = Object.freeze(["S3", "S4", "S5", "S6:T2", "S6:T3", "S8"]);

/** Every derivable Node 54 leg, keyed by branch. */
export function buildNode54Legs(){
  return NODE54_BRANCH_KEYS
    .map((branchKey) => buildNode54Leg(branchKey))
    .filter((leg) => leg.nodes.length > 0);
}

/** Find the leg and node that own a PCOT identifier such as "2058". */
export function findNode54LegForPcot(np){
  const target = String(np || "").trim();
  if (!target) return null;
  for (const leg of buildNode54Legs()){
    const node = leg.nodes.find((item) => item.np === target || item.cp === target || item.id === target);
    if (node) return { leg, node };
  }
  return null;
}
