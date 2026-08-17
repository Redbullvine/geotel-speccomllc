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
    pon: "P0002", device: "First PCOT", why: "This is the first recorded S5 PCOT and historically has substantially stronger power than downstream S5 points.",
    details: "LOW/HIGH meanings are unknown. Physically identify and photograph the ports before recording their functions.",
    steps: Object.freeze(makePcotSteps("2056", "S5", [-21.04, -37.20])),
  }),
  Object.freeze({
    id: "np2058", number: 6, np: "2058", cp: "12913", siteTerms: ["2058", "cp12913"], title: "NP2058 / CP12913 — S4:L1",
    pon: "P0002", device: "First PCOT", why: "This is the first recorded S4 PCOT and historically has substantially stronger power than farther downstream S4 points.",
    details: "LOW/HIGH meanings are unknown. Physically identify and photograph the ports before recording their functions.",
    steps: Object.freeze(makePcotSteps("2058", "S4", [-39.34, -22.19])),
  }),
  Object.freeze({
    id: "np12001", number: 7, np: "12001", cp: "12917", siteTerms: ["12001", "cp12917"], title: "NP12001 / CP12917 — S3:L1",
    pon: "P0002", device: "First PCOT", why: "This is the first recorded S3 PCOT and historically has substantially stronger power than farther downstream S3 points.",
    details: "LOW/HIGH meanings are unknown. Physically identify and photograph the ports before recording their functions.",
    steps: Object.freeze(makePcotSteps("12001", "S3", [-40.29, -23.17])),
  }),
  Object.freeze({
    id: "np2017", number: 8, np: "2017", cp: "13803", siteTerms: ["2017", "cp13803"], title: "NP2017 / CP13803 — S8:L1",
    pon: "P0002", device: "S8 location", why: "S8 is a separate P0002 branch. Its historical -30.13 dBm reading warrants its own verification and must not be mixed with S3-S6 conclusions.",
    details: "Record the exact physical point and measured path.",
    steps: Object.freeze([step("2017-s8", "Measure S8:L1", "S8", "termination", -30.13)]),
  }),
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

export const NODE54_SCHEMATIC_SEGMENTS = Object.freeze([
  Object.freeze({ from: "np2015", to: "cp13817", paths: "S3/F35 · S4/F36 · S5/F37", color: "#38bdf8" }),
  Object.freeze({ from: "np2015", to: "np1696", paths: "S6/F38", color: "#c084fc" }),
  Object.freeze({ from: "np1696", to: "cp13817", paths: "S6:T2/F42", color: "#22c55e" }),
  Object.freeze({ from: "np1696", to: "np1697", paths: "S6:T3/F43", color: "#c084fc" }),
  Object.freeze({ from: "cp13817", to: "np12001", paths: "S3/F35", color: "#38bdf8" }),
  Object.freeze({ from: "cp13817", to: "np2058", paths: "S4/F36", color: "#f59e0b" }),
  Object.freeze({ from: "cp13817", to: "np2056", paths: "S5/F37", color: "#fb7185" }),
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
