export const NODE54_PROJECT_ID = "d5d54efe-0048-455d-be76-9c1423295d3a";
export const NODE54_PROJECT_NAME = "ruidoso revisit";

export const NODE54_STATUS = Object.freeze({
  UNTESTED: "untested",
  INVESTIGATING: "investigating",
  CLEARED: "cleared",
  ISOLATED: "isolated",
  HISTORICAL_GOOD: "historical_good",
  HISTORICAL_WEAK: "historical_weak",
  REVERIFIED: "reverified",
});

export const NODE54_THRESHOLDS = Object.freeze({
  materialLossDb: 3,
  approximatelyEqualDb: 1.5,
  weakAbsoluteDbm: -28,
});

// These are engineering/production-code design references, not manufacturer data
// sheets. Treat the loss comparison as estimated until the installed product label
// can be photographed and confirmed in the field.
export const NODE54_TAP_RATIO_ESTIMATES = Object.freeze({
  "90/10": Object.freeze({ throughLossDb: 0.7, tapLossDb: 10.5 }),
  "85/15": Object.freeze({ throughLossDb: 1.0, tapLossDb: 8.5 }),
  "80/20": Object.freeze({ throughLossDb: 1.4, tapLossDb: 7.5 }),
  "70/30": Object.freeze({ throughLossDb: 2.0, tapLossDb: 5.5 }),
  "60/40": Object.freeze({ throughLossDb: 2.6, tapLossDb: 4.5 }),
});

const step = (id, label, path, designation, reference = null, extra = {}) => Object.freeze({
  id, label, path, designation, wavelength: 1550, reference, ...extra,
});

export const NODE54_STOPS = Object.freeze([
  Object.freeze({
    id: "cp13817", number: 1, np: "1702", cp: "13817", siteTerms: ["1702", "cp13817"],
    title: "CP13817 / NP1702", pon: "P0002", device: "Breakout enclosure",
    why: "S3/F35, S4/F36 and S5/F37 pass through this enclosure and break out onto separate 1-count cables. S6:T2/F42 terminates here and is a useful control, but a good F42 result does not prove adjacent fibers are good.",
    details: "Compare each branch immediately before and after its breakout splice to separate upstream weakness from loss inside this enclosure and downstream plant.",
    steps: Object.freeze([
      step("cp-f42", "Measure F42 / S6:T2 control", "S6:T2", "control", -20.71, { fiber: "F42" }),
      step("cp-f35-in", "Measure F35 before S3 breakout", "S3", "before", null, { fiber: "F35" }),
      step("cp-f35-out", "Measure F35 after S3 breakout", "S3", "after", null, { fiber: "F35", nextStopId: "np12001" }),
      step("cp-f36-in", "Measure F36 before S4 breakout", "S4", "before", null, { fiber: "F36" }),
      step("cp-f36-out", "Measure F36 after S4 breakout", "S4", "after", null, { fiber: "F36", nextStopId: "np2058" }),
      step("cp-f37-in", "Measure F37 before S5 breakout", "S5", "before", null, { fiber: "F37" }),
      step("cp-f37-out", "Measure F37 after S5 breakout", "S5", "after", null, { fiber: "F37", nextStopId: "np2056" }),
    ]),
  }),
  Object.freeze({
    id: "np2015", number: 2, np: "2015", cp: "", siteTerms: ["2015"], title: "NP2015 — P0002 Source",
    pon: "P0002", device: "1x8 splitter", why: "This is the P0002 source and 1x8 splitter. Test here when a branch is already weak before CP13817 or when a common-source problem must be ruled in or out.",
    details: "S7 historical readings argue against one complete P0002 feeder failure. Test each relevant splitter output independently.",
    steps: Object.freeze([
      step("source-in", "Measure P0002 splitter input", "P0002", "input"),
      step("source-s3", "Measure splitter output S3 / F35", "S3", "output", null, { fiber: "F35" }),
      step("source-s4", "Measure splitter output S4 / F36", "S4", "output", null, { fiber: "F36" }),
      step("source-s5", "Measure splitter output S5 / F37", "S5", "output", null, { fiber: "F37" }),
      step("source-s6", "Measure splitter output S6 / F38", "S6", "output", null, { fiber: "F38" }),
      step("source-s7", "Measure splitter output S7", "S7", "output", -21.06),
      step("source-s8", "Measure splitter output S8", "S8", "output"),
    ]),
  }),
  Object.freeze({
    id: "np1696", number: 3, np: "1696", cp: "", siteTerms: ["1696"], title: "NP1696 — S6 Distribution",
    pon: "P0002", device: "S6 split point", why: "F38 is the S6 common feed. At this location F41, F42 and F43 become S6:T1, T2 and T3; T4 terminates locally.",
    details: "A branch result here applies only to the measured fiber/path, not the whole cable.",
    steps: Object.freeze([
      step("1696-f38", "Measure F38 / S6 common feed", "S6", "before", null, { fiber: "F38" }),
      step("1696-f41", "Measure F41 / S6:T1", "S6:T1", "after", null, { fiber: "F41" }),
      step("1696-f42", "Measure F42 / S6:T2", "S6:T2", "after", null, { fiber: "F42" }),
      step("1696-f43", "Measure F43 / S6:T3", "S6:T3", "after", null, { fiber: "F43", nextStopId: "np1697" }),
      step("1696-t4", "Measure local S6:T4 termination", "S6:T4", "termination", -27.97),
    ]),
  }),
  Object.freeze({
    id: "np1697", number: 4, np: "1697", cp: "", siteTerms: ["1697"], title: "NP1697 — S6:T3",
    pon: "P0002", device: "PCOT / termination", why: "This is the next known S6:T3 test point after NP1696 and has a historical -31.77 dBm reading.",
    details: "Reverify the specific T3 path. Do not use a neighboring branch as proof.",
    steps: Object.freeze([step("1697-t3", "Measure S6:T3", "S6:T3", "termination", -31.77, { fiber: "F43" })]),
  }),
  Object.freeze({
    id: "np2056", number: 5, np: "2056", cp: "11752", siteTerms: ["2056", "cp11752"], title: "NP2056 / CP11752 — S5:L1",
    pon: "P0002", device: "First PCOT", expectedRatio: "90/10", why: "This is the first recorded S5 PCOT and historically has substantially stronger power than downstream S5 points.",
    details: "LOW/HIGH meanings are unknown. Physically identify and photograph the ports before recording their functions.",
    steps: Object.freeze(makePcotSteps("2056", "S5", [-21.04, -37.20])),
  }),
  Object.freeze({
    id: "np2058", number: 6, np: "2058", cp: "12913", siteTerms: ["2058", "cp12913"], title: "NP2058 / CP12913 — S4:L1",
    pon: "P0002", device: "First PCOT", expectedRatio: "90/10", why: "This is the first recorded S4 PCOT and historically has substantially stronger power than farther downstream S4 points.",
    details: "LOW/HIGH meanings are unknown. Physically identify and photograph the ports before recording their functions.",
    steps: Object.freeze(makePcotSteps("2058", "S4", [-39.34, -22.19])),
  }),
  Object.freeze({
    id: "np12001", number: 7, np: "12001", cp: "12917", siteTerms: ["12001", "cp12917"], title: "NP12001 / CP12917 — S3:L1",
    pon: "P0002", device: "First PCOT", expectedRatio: "90/10", why: "This is the first recorded S3 PCOT and historically has substantially stronger power than farther downstream S3 points.",
    details: "LOW/HIGH meanings are unknown. Physically identify and photograph the ports before recording their functions.",
    steps: Object.freeze(makePcotSteps("12001", "S3", [-40.29, -23.17])),
  }),
  Object.freeze({
    id: "np2017", number: 8, np: "2017", cp: "13803", siteTerms: ["2017", "cp13803"], title: "NP2017 / CP13803 — S8:L1",
    pon: "P0002", device: "PCOT", expectedRatio: "90/10", why: "S8 is a separate P0002 branch. Its historical -30.13 dBm reading warrants its own verification and must not be mixed with S3-S6 conclusions.",
    details: "Record the exact physical point and measured path.",
    steps: Object.freeze([step("2017-s8", "Measure S8:L1", "S8", "termination", -30.13)]),
  }),
  // Downstream PCOTs are included so a weak branch can be traced beyond the
  // first PCOT. Ratios come from imported production codes, not a guess at
  // the installed device; the field card requires physical confirmation.
  Object.freeze({ id: "np1713", number: 9, np: "1713", cp: "", siteTerms: ["1713"], title: "NP1713 — S3 downstream PCOT", pon: "P0002", device: "PCOT", expectedRatio: "85/15", why: "Historical S3 readings are weak here; compare physical input and through/out before assigning the fault.", details: "Historical LOW -56.21 / HIGH -40.02 dBm; designation meaning is not confirmed.", steps: Object.freeze(makePcotSteps("1713", "S3", [-56.21, -40.02])) }),
  Object.freeze({ id: "np2066", number: 10, np: "2066", cp: "", siteTerms: ["2066"], title: "NP2066 — S3 downstream PCOT", pon: "P0002", device: "PCOT", expectedRatio: "80/20", why: "Continue the S3 trace only after the prior S3 point is identified and tested.", details: "Historical S3 reading -40.32 dBm.", steps: Object.freeze(makePcotSteps("2066", "S3", [-40.32])) }),
  Object.freeze({ id: "np1708", number: 11, np: "1708", cp: "", siteTerms: ["1708"], title: "NP1708 — S3 downstream PCOT", pon: "P0002", device: "PCOT", expectedRatio: "70/30", why: "Downstream S3 comparison point.", details: "Historical LOW -40.65 / HIGH -28.39 dBm; designation meaning is not confirmed.", steps: Object.freeze(makePcotSteps("1708", "S3", [-40.65, -28.39])) }),
  Object.freeze({ id: "np2067", number: 12, np: "2067", cp: "", siteTerms: ["2067"], title: "NP2067 — S3 downstream PCOT", pon: "P0002", device: "PCOT", expectedRatio: "60/40", why: "Final listed S3 comparison point in the historical workbook.", details: "Historical raw-workbook S3 reading -41.32 dBm.", steps: Object.freeze(makePcotSteps("2067", "S3", [-41.32])) }),
  Object.freeze({ id: "np2060", number: 13, np: "2060", cp: "", siteTerms: ["2060"], title: "NP2060 — S4 downstream PCOT", pon: "P0002", device: "PCOT", expectedRatio: "85/15", why: "Downstream S4 comparison point.", details: "Historical S4 reading -53.83 dBm.", steps: Object.freeze(makePcotSteps("2060", "S4", [-53.83])) }),
  Object.freeze({ id: "np2062", number: 14, np: "2062", cp: "", siteTerms: ["2062"], title: "NP2062 — S4 downstream PCOT", pon: "P0002", device: "PCOT", expectedRatio: "80/20", why: "Downstream S4 comparison point.", details: "Historical S4 reading -54.05 dBm.", steps: Object.freeze(makePcotSteps("2062", "S4", [-54.05])) }),
  Object.freeze({ id: "np1715", number: 15, np: "1715", cp: "", siteTerms: ["1715"], title: "NP1715 — S4 downstream PCOT", pon: "P0002", device: "PCOT", expectedRatio: "70/30", why: "Final listed S4 comparison point in the historical workbook.", details: "Historical S4 reading -54.22 dBm.", steps: Object.freeze(makePcotSteps("1715", "S4", [-54.22])) }),
  Object.freeze({ id: "np1706", number: 16, np: "1706", cp: "", siteTerms: ["1706"], title: "NP1706 — S5 downstream PCOT", pon: "P0002", device: "PCOT", expectedRatio: "85/15", why: "Downstream S5 comparison point.", details: "Historical S5 reading -38.39 dBm.", steps: Object.freeze(makePcotSteps("1706", "S5", [-38.39])) }),
  Object.freeze({ id: "np1699", number: 17, np: "1699", cp: "", siteTerms: ["1699"], title: "NP1699 — S5 downstream PCOT", pon: "P0002", device: "PCOT", expectedRatio: "80/20", why: "Downstream S5 comparison point.", details: "Historical S5 reading -38.45 dBm.", steps: Object.freeze(makePcotSteps("1699", "S5", [-38.45])) }),
  Object.freeze({ id: "np2054", number: 18, np: "2054", cp: "", siteTerms: ["2054"], title: "NP2054 — S5 downstream PCOT", pon: "P0002", device: "PCOT", expectedRatio: "70/30", why: "Downstream S5 comparison point.", details: "Historical S5 reading -38.29 dBm.", steps: Object.freeze(makePcotSteps("2054", "S5", [-38.29])) }),
  Object.freeze({ id: "np1704", number: 19, np: "1704", cp: "", siteTerms: ["1704"], title: "NP1704 — S5 downstream PCOT", pon: "P0002", device: "PCOT", expectedRatio: "60/40", why: "Final listed S5 comparison point in the historical workbook.", details: "Historical S5 reading -39.84 dBm.", steps: Object.freeze(makePcotSteps("1704", "S5", [-39.84])) }),
  Object.freeze({ id: "np2103", number: 20, np: "2103", cp: "", siteTerms: ["2103"], title: "NP2103 — S8 reference PCOT", pon: "P0002", device: "PCOT", expectedRatio: "90/10", why: "Separate S8 comparison point; do not mix it into S3-S6 conclusions.", details: "Historical S8 reading -25.54 dBm.", steps: Object.freeze([step("2103-s8", "Measure S8", "S8", "termination", -25.54)]) }),
  Object.freeze({ id: "np2019", number: 21, np: "2019", cp: "", siteTerms: ["2019"], title: "NP2019 — S8 reference", pon: "P0002", device: "S8 location", why: "Separate S8 endpoint with no historical measurement.", details: "Establish a new baseline and retain the exact port identification.", steps: Object.freeze([step("2019-s8", "Measure S8", "S8", "termination")]) }),
]);

function makePcotSteps(prefix, path, historical){
  return [
    step(`${prefix}-in`, `Identify port; measure ${path} incoming`, path, "incoming", historical?.[0] ?? null, { requiresPortId: true }),
    step(`${prefix}-a`, "Identify and measure physical port A", path, "port_a", historical?.[1] ?? null, { requiresPortId: true }),
    step(`${prefix}-b`, "Identify and measure physical port B", path, "port_b", null, { requiresPortId: true }),
    step(`${prefix}-out`, "Identify and measure outgoing continuation", path, "outgoing", null, { requiresPortId: true }),
  ];
}

export const NODE54_HISTORY = Object.freeze({
  S3: Object.freeze(["NP12001 — LOW -40.29 / HIGH -23.17", "NP1713 — LOW -56.21 / HIGH -40.02", "NP2066 — -40.32", "NP1708 — LOW -40.65 / HIGH -28.39", "NP2067 — raw workbook -41.32"]),
  S4: Object.freeze(["NP2058 — LOW -39.34 / HIGH -22.19", "NP2060 — -53.83", "NP2062 — -54.05", "NP1715 — -54.22"]),
  S5: Object.freeze(["NP2056 — LOW -21.04 / HIGH -37.20", "NP1706 — -38.39", "NP1699 — -38.45", "NP2054 — -38.29", "NP1704 — -39.84"]),
  S6: Object.freeze(["T2 NP1702 — -20.71 (meter photo confirmed)", "T3 NP1697 — -31.77", "T4 NP1696 — LOW -27.97 / HIGH -34.69"]),
  S7: Object.freeze(["T1 NP2105 — -19.79", "T2 NP2020 — -20.70", "T3 NP13308 — -22.96", "T4 NP2015 — -21.06"]),
  S8: Object.freeze(["NP2017 — -30.13", "NP2103 — -25.54", "NP2019 — no historical measurement"]),
});

// Imported photo manifests prove prior field presence and preserve the original
// source report. They are not optical readings and intentionally do not invent
// a time of day or port designation that was not present in the import.
export const NODE54_IMPORTED_EVIDENCE = Object.freeze({
  "12001": Object.freeze([{ technician: "Raphael Marinho", date: "2026-01-13", photos: 6 }]),
  "1696": Object.freeze([{ technician: "Raphael Marinho", date: "2026-01-15", photos: 6 }]),
  "1697": Object.freeze([{ technician: "Raphael Marinho", date: "2026-01-14", photos: 6 }]),
  "1699": Object.freeze([{ technician: "Raphael Marinho", date: "2026-01-11", photos: 6 }]),
  "1702": Object.freeze([{ technician: "Raphael Marinho", date: "2026-01-12", photos: 6 }, { technician: "Raphael Marinho", date: "2026-02-07", photos: 5, note: "Re-entry" }]),
  "1704": Object.freeze([{ technician: "Raphael Marinho", date: "2026-01-11", photos: 6 }]),
  "1706": Object.freeze([{ technician: "Raphael Marinho", date: "2026-01-11", photos: 6 }]),
  "1708": Object.freeze([{ technician: "Raphael Marinho", date: "2026-01-13", photos: 6 }]),
  "1713": Object.freeze([{ technician: "Raphael Marinho", date: "2026-01-13", photos: 5 }]),
  "1715": Object.freeze([{ technician: "Raphael Marinho", date: "2026-01-14", photos: 6 }]),
  "2015": Object.freeze([{ technician: "Raphael Marinho", date: "2026-01-12", photos: 6 }]),
  "2017": Object.freeze([{ technician: "Raphael Marinho", date: "2026-01-11", photos: 6 }]),
  "2054": Object.freeze([{ technician: "Raphael Marinho", date: "2026-01-11", photos: 6 }]),
  "2056": Object.freeze([{ technician: "Raphael Marinho", date: "2026-01-13", photos: 6 }]),
  "2058": Object.freeze([{ technician: "Raphael Marinho", date: "2026-01-14", photos: 6 }]),
  "2060": Object.freeze([{ technician: "Raphael Marinho", date: "2026-01-14", photos: 6 }]),
  "2062": Object.freeze([{ technician: "Raphael Marinho", date: "2026-01-13", photos: 6 }]),
  "2066": Object.freeze([{ technician: "Raphael Marinho", date: "2026-01-13", photos: 6 }]),
  "2067": Object.freeze([{ technician: "Raphael Marinho", date: "2026-01-14", photos: 6 }]),
  "2103": Object.freeze([{ technician: "Raphael Marinho", date: "2026-01-11", photos: 6 }]),
});

export const NODE54_SCHEMATIC_SEGMENTS = Object.freeze([
  Object.freeze({ from: "np2015", to: "cp13817", paths: "S3/F35 · S4/F36 · S5/F37", color: "#38bdf8" }),
  Object.freeze({ from: "np2015", to: "np1696", paths: "S6/F38", color: "#c084fc" }),
  Object.freeze({ from: "np1696", to: "cp13817", paths: "S6:T2/F42", color: "#22c55e" }),
  Object.freeze({ from: "np1696", to: "np1697", paths: "S6:T3/F43", color: "#c084fc" }),
  Object.freeze({ from: "cp13817", to: "np12001", paths: "S3/F35", color: "#38bdf8" }),
  Object.freeze({ from: "cp13817", to: "np2058", paths: "S4/F36", color: "#f59e0b" }),
  Object.freeze({ from: "cp13817", to: "np2056", paths: "S5/F37", color: "#fb7185" }),
  Object.freeze({ from: "np12001", to: "np1713", paths: "S3 downstream trace", color: "#38bdf8" }),
  Object.freeze({ from: "np1713", to: "np2066", paths: "S3 downstream trace", color: "#38bdf8" }),
  Object.freeze({ from: "np2066", to: "np1708", paths: "S3 downstream trace", color: "#38bdf8" }),
  Object.freeze({ from: "np1708", to: "np2067", paths: "S3 downstream trace", color: "#38bdf8" }),
  Object.freeze({ from: "np2058", to: "np2060", paths: "S4 downstream trace", color: "#f59e0b" }),
  Object.freeze({ from: "np2060", to: "np2062", paths: "S4 downstream trace", color: "#f59e0b" }),
  Object.freeze({ from: "np2062", to: "np1715", paths: "S4 downstream trace", color: "#f59e0b" }),
  Object.freeze({ from: "np2056", to: "np1706", paths: "S5 downstream trace", color: "#fb7185" }),
  Object.freeze({ from: "np1706", to: "np1699", paths: "S5 downstream trace", color: "#fb7185" }),
  Object.freeze({ from: "np1699", to: "np2054", paths: "S5 downstream trace", color: "#fb7185" }),
  Object.freeze({ from: "np2054", to: "np1704", paths: "S5 downstream trace", color: "#fb7185" }),
  Object.freeze({ from: "np2015", to: "np2017", paths: "S8 separate branch", color: "#60a5fa" }),
  Object.freeze({ from: "np2017", to: "np2103", paths: "S8 reference trace", color: "#60a5fa" }),
  Object.freeze({ from: "np2103", to: "np2019", paths: "S8 reference trace", color: "#60a5fa" }),
]);

export function isNode54Project(project){
  const id = String(project?.id || "").trim().toLowerCase();
  const name = String(project?.name || "").trim().toLowerCase().replace(/\s+/g, " ");
  return id === NODE54_PROJECT_ID || name === NODE54_PROJECT_NAME;
}

export function assessComponentPair(incoming, outgoing, thresholds = NODE54_THRESHOLDS){
  if (incoming === null || incoming === undefined || String(incoming).trim() === "" || outgoing === null || outgoing === undefined || String(outgoing).trim() === ""){
    return { code: "incomplete", label: "MORE READINGS REQUIRED", deltaDb: null, kind: "inference" };
  }
  const before = Number(incoming);
  const after = Number(outgoing);
  if (!Number.isFinite(before) || !Number.isFinite(after)){
    return { code: "incomplete", label: "MORE READINGS REQUIRED", deltaDb: null, kind: "inference" };
  }
  const deltaDb = Number((before - after).toFixed(2));
  if (before <= thresholds.weakAbsoluteDbm){
    return { code: "weak_upstream", label: "SIGNAL IS ALREADY WEAK BEFORE THIS COMPONENT", deltaDb, kind: "inference" };
  }
  if (deltaDb >= thresholds.materialLossDb){
    return { code: "isolated", label: "LOSS INTERVAL ISOLATED AT THIS COMPONENT", deltaDb, kind: "fault_isolated_by_current_test" };
  }
  if (Math.abs(deltaDb) <= thresholds.approximatelyEqualDb && after > thresholds.weakAbsoluteDbm){
    return { code: "cleared", label: "COMPONENT CLEARED BY CURRENT TEST", deltaDb, kind: "inference" };
  }
  return { code: "inconclusive", label: "RESULT IS INCONCLUSIVE — VERIFY SETUP AND CONTINUE TESTING", deltaDb, kind: "inference" };
}

export function assessNode54Device({
  inputDbm = null,
  throughDbm = null,
  expectedRatio = "",
  actualRatio = "",
  direction = "unknown",
  thresholds = NODE54_THRESHOLDS,
} = {}){
  const input = Number(inputDbm);
  const through = Number(throughDbm);
  const hasInput = Number.isFinite(input);
  const hasThrough = Number.isFinite(through);
  const estimate = NODE54_TAP_RATIO_ESTIMATES[String(expectedRatio || "").trim()] || null;
  const ratioMismatch = Boolean(actualRatio && expectedRatio && String(actualRatio).trim() !== String(expectedRatio).trim());
  if (direction === "reversed") return { status: "suspect", code: "possible_reversed", label: "POSSIBLE REVERSED TAP TERMINAL - VERIFY BEFORE CONTINUING", nextAction: "remain", deltaDb: null, estimated: Boolean(estimate) };
  if (ratioMismatch) return { status: "suspect", code: "ratio_mismatch", label: "DESIGNED RATIO DOES NOT MATCH INSTALLED RATIO", nextAction: "remain", deltaDb: null, estimated: Boolean(estimate) };
  if (!hasInput) return { status: "suspect", code: "input_required", label: "INSUFFICIENT EVIDENCE - MEASURE INPUT", nextAction: "remain", deltaDb: null, estimated: Boolean(estimate) };
  if (input <= thresholds.weakAbsoluteDbm) return { status: "suspect", code: "weak_upstream", label: "SIGNAL IS ALREADY WEAK BEFORE DEVICE", nextAction: "upstream", deltaDb: null, estimated: Boolean(estimate) };
  if (!hasThrough) return { status: "suspect", code: "through_required", label: "INPUT RECORDED - MEASURE THROUGH/OUT", nextAction: "remain", deltaDb: null, estimated: Boolean(estimate) };
  const deltaDb = Number((input - through).toFixed(2));
  const excessiveAt = estimate ? estimate.throughLossDb + 2 : thresholds.materialLossDb;
  if (deltaDb >= excessiveAt){
    return { status: "fault_isolated", code: "excessive_device_loss", label: "FAULT INTERVAL ISOLATED AT DEVICE / PORT PAIR", nextAction: "remain", deltaDb, estimated: Boolean(estimate), expectedThroughLossDb: estimate?.throughLossDb ?? null };
  }
  return { status: "pass", code: "device_normal", label: estimate ? "DEVICE THROUGH PATH APPEARS NORMAL (ESTIMATED RATIO COMPARISON)" : "DEVICE THROUGH PATH APPEARS NORMAL", nextAction: "downstream", deltaDb, estimated: Boolean(estimate), expectedThroughLossDb: estimate?.throughLossDb ?? null };
}

export function buildBranchStatuses(readings = []){
  const statuses = { S3: NODE54_STATUS.UNTESTED, S4: NODE54_STATUS.UNTESTED, S5: NODE54_STATUS.UNTESTED, "S6:T1": NODE54_STATUS.UNTESTED, "S6:T2": NODE54_STATUS.HISTORICAL_GOOD, "S6:T3": NODE54_STATUS.UNTESTED, "S6:T4": NODE54_STATUS.UNTESTED, S7: NODE54_STATUS.HISTORICAL_GOOD, S8: NODE54_STATUS.UNTESTED };
  for (const reading of readings){
    const path = String(reading?.path || "");
    if (!path || !(path in statuses)) continue;
    if (reading?.interpretation?.code === "isolated") statuses[path] = NODE54_STATUS.ISOLATED;
    else if (reading?.interpretation?.code === "cleared") statuses[path] = NODE54_STATUS.CLEARED;
    else if (reading?.designation === "control" && path === "S6:T2") statuses[path] = NODE54_STATUS.REVERIFIED;
    else if (![NODE54_STATUS.ISOLATED, NODE54_STATUS.CLEARED].includes(statuses[path])) statuses[path] = NODE54_STATUS.INVESTIGATING;
  }
  return statuses;
}
