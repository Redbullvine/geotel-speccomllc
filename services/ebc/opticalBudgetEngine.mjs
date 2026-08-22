/**
 * EBC — deterministic optical budget engine.
 *
 * No DOM, no app state, no I/O. Given a leg definition it returns a full
 * cascaded result with every individual loss component retained so a
 * technician can audit exactly how a number was produced.
 *
 * Cascade formulae
 * ----------------
 *   spanLoss     = fiberLoss + spliceLoss + connectorLoss + extraLoss
 *   fiberLoss    = distance x attenuationCoefficient
 *   spliceLoss   = spliceCount x spliceLossDb
 *   connectorLoss= connectorCount x connectorLossDb
 *
 *   nodeInput    = upstreamOutput - spanLoss
 *   tapOutput    = nodeInput - tapInsertionLoss
 *   throughOutput= nodeInput - throughInsertionLoss
 *
 * The chain then continues downstream from throughOutput. A PCOT is never
 * evaluated on its own when it belongs to a cascade: calculateLeg always walks
 * the whole chain, so changing any upstream device re-derives every downstream
 * location by construction.
 *
 * Engineering margin
 * ------------------
 *   margin = predictedReceivePower - minimumRequiredReceivePower
 *
 * The configured engineering reserve is used as the PASS threshold rather than
 * being subtracted into the budget, so it is never double counted and the
 * reported margin stays the plain difference above.
 */

import { EBC_PROVENANCE } from "./provenance.mjs";
import { DEFAULT_PCOT_SPECS, finiteOrNull, getPcotSpec, parseRatio, resolveInsertionLoss } from "./pcotSpecs.mjs";
import { EBC_CONFIDENCE, validateLeg } from "./validation.mjs";
import { EBC_DATA_CLASS, describeProvenance } from "./engineeringConstants.mjs";

export const EBC_STATUS = Object.freeze({
  PASS: "PASS",
  MARGINAL: "MARGINAL",
  FAIL: "FAIL",
  UNKNOWN: "UNKNOWN",
});

export const EBC_NODE_TYPE = Object.freeze({
  PCOT: "pcot",
  TERMINAL: "terminal",
  PASSIVE: "passive",
  REFERENCE: "reference",
});

const KM_PER_MILE = 1.609344;
const METERS_PER_KM = 1000;
const FEET_PER_KM = 3280.839895;

const round2 = (value) => (value === null || value === undefined || !Number.isFinite(Number(value)))
  ? null
  : Number(Number(value).toFixed(2));

/** Convert a span distance to kilometres. Returns null when not supplied. */
export function toKilometres(distance, unit){
  const value = finiteOrNull(distance);
  if (value === null) return null;
  switch (String(unit || "km").toLowerCase()){
    case "mi":
    case "mile":
    case "miles": return value * KM_PER_MILE;
    case "m":
    case "meter":
    case "metre":
    case "meters": return value / METERS_PER_KM;
    case "ft":
    case "foot":
    case "feet": return value / FEET_PER_KM;
    default: return value;
  }
}

/** Attenuation in dB/km, accepting either a per-km or a per-mile coefficient. */
export function attenuationDbPerKm(fiber){
  const perKm = finiteOrNull(fiber?.attenuationDbPerKm);
  if (perKm !== null) return perKm;
  const perMile = finiteOrNull(fiber?.attenuationDbPerMile);
  if (perMile !== null) return perMile / KM_PER_MILE;
  return null;
}

/**
 * Compute one span and keep every component.
 * A missing distance or coefficient contributes 0 dB and is recorded as an
 * assumption rather than being silently absorbed.
 */
export function computeSpan(span, leg){
  const fiber = leg?.fiber || {};
  const defaults = leg?.defaults || {};
  const assumptions = [];

  const distanceUnit = String(span?.distanceUnit || fiber.distanceUnit || "km").toLowerCase();
  const distanceKm = toKilometres(span?.distance, distanceUnit);
  const coefficient = attenuationDbPerKm(fiber);

  let fiberLossDb = 0;
  if (distanceKm !== null && coefficient !== null){
    fiberLossDb = distanceKm * coefficient;
  } else if (distanceKm !== null && coefficient === null){
    assumptions.push("No attenuation coefficient configured; fiber loss counted as 0 dB.");
  } else if (distanceKm === null && coefficient !== null){
    assumptions.push("No span distance recorded; fiber loss counted as 0 dB.");
  } else {
    assumptions.push("No span distance or attenuation configured; fiber loss counted as 0 dB.");
  }

  const spliceCount = finiteOrNull(span?.spliceCount) ?? 0;
  const perSpliceDb = finiteOrNull(span?.spliceLossDb) ?? finiteOrNull(defaults.spliceLossDb) ?? 0;
  const spliceLossDb = spliceCount * perSpliceDb;
  if (spliceCount > 0 && finiteOrNull(span?.spliceLossDb) === null && finiteOrNull(defaults.spliceLossDb) === null){
    assumptions.push("Splice count entered with no per-splice loss; splice loss counted as 0 dB.");
  }

  const connectorCount = finiteOrNull(span?.connectorCount) ?? 0;
  const perConnectorDb = finiteOrNull(span?.connectorLossDb) ?? finiteOrNull(defaults.connectorLossDb) ?? 0;
  const connectorLossDb = connectorCount * perConnectorDb;
  if (connectorCount > 0 && finiteOrNull(span?.connectorLossDb) === null && finiteOrNull(defaults.connectorLossDb) === null){
    assumptions.push("Connector count entered with no per-connector loss; connector loss counted as 0 dB.");
  }

  const extraLossDb = finiteOrNull(span?.extraLossDb) ?? 0;
  const totalDb = fiberLossDb + spliceLossDb + connectorLossDb + extraLossDb;

  return {
    distance: finiteOrNull(span?.distance),
    distanceUnit,
    distanceKm,
    attenuationDbPerKm: coefficient,
    fiberLossDb,
    spliceCount,
    perSpliceDb,
    spliceLossDb,
    connectorCount,
    perConnectorDb,
    connectorLossDb,
    extraLossDb,
    totalDb,
    assumptions,
  };
}

function spanTraceEntries(span, prefix = ""){
  const entries = [];
  const label = (text) => (prefix ? prefix + " " + text : text);
  if (span.fiberLossDb > 0 || span.distanceKm !== null){
    const detail = span.distanceKm !== null && span.attenuationDbPerKm !== null
      ? " (" + round2(span.distanceKm) + " km x " + span.attenuationDbPerKm + " dB/km)"
      : "";
    entries.push({ label: label("Fiber loss") + detail, kind: "loss", valueDb: span.fiberLossDb });
  }
  if (span.spliceCount > 0){
    entries.push({ label: label("Splice loss") + " (" + span.spliceCount + " x " + span.perSpliceDb + " dB)", kind: "loss", valueDb: span.spliceLossDb });
  }
  if (span.connectorCount > 0){
    entries.push({ label: label("Connector loss") + " (" + span.connectorCount + " x " + span.perConnectorDb + " dB)", kind: "loss", valueDb: span.connectorLossDb });
  }
  if (span.extraLossDb > 0){
    entries.push({ label: label("Additional recorded loss"), kind: "loss", valueDb: span.extraLossDb });
  }
  return entries;
}

/**
 * Classify a margin. The engineering reserve is the PASS threshold; anything
 * that clears the receiver minimum but not the reserve is MARGINAL.
 */
export function classifyMargin(marginDb, { engineeringReserveDb = 0, powerDbm = null, receiverMaxDbm = null } = {}){
  if (marginDb === null || marginDb === undefined || !Number.isFinite(Number(marginDb))){
    return { status: EBC_STATUS.UNKNOWN, code: "NO_MARGIN", reason: "Engineering limits or predicted power are missing." };
  }
  const max = finiteOrNull(receiverMaxDbm);
  const power = finiteOrNull(powerDbm);
  if (max !== null && power !== null && power > max){
    return { status: EBC_STATUS.FAIL, code: "RECEIVER_OVERLOAD", reason: "Predicted power " + round2(power) + " dBm is above the receiver maximum of " + max + " dBm." };
  }
  const reserve = finiteOrNull(engineeringReserveDb) ?? 0;
  if (marginDb < 0){
    return { status: EBC_STATUS.FAIL, code: "BELOW_RECEIVER_MINIMUM", reason: "Predicted power is " + round2(Math.abs(marginDb)) + " dB below the receiver minimum." };
  }
  if (marginDb < reserve){
    return { status: EBC_STATUS.MARGINAL, code: "BELOW_ENGINEERING_RESERVE", reason: "Above the receiver minimum but " + round2(reserve - marginDb) + " dB short of the " + reserve + " dB engineering reserve." };
  }
  return { status: EBC_STATUS.PASS, code: "WITHIN_LIMITS", reason: "Meets the receiver minimum with the configured engineering reserve." };
}

/** Deep structural copy so a calculation can never write back into source data. */
export function cloneLeg(leg){
  return JSON.parse(JSON.stringify(leg ?? null));
}

function normalizeLimits(limits){
  return {
    receiverMinDbm: finiteOrNull(limits?.receiverMinDbm),
    receiverMaxDbm: finiteOrNull(limits?.receiverMaxDbm),
    engineeringReserveDb: finiteOrNull(limits?.engineeringReserveDb) ?? 0,
  };
}

/**
 * Calculate the whole cascade.
 *
 * options:
 *   specs           PCOT specification set (defaults to the seeded set)
 *   lossBasis       "nominal" | "max"
 *   ratioOverrides  { [nodeId]: ratio } applied for this calculation only.
 *                   Used by What-If; the caller's leg object is never touched.
 *   mode            "design" | "field"
 */
export function calculateLeg(leg, options = {}){
  const {
    specs = DEFAULT_PCOT_SPECS,
    lossBasis = "nominal",
    ratioOverrides = {},
    mode = "design",
    strictWavelength = false,
  } = options;

  const working = cloneLeg(leg) || { nodes: [] };
  const validation = validateLeg(working, { specs, lossBasis, mode, strictWavelength });
  const limits = normalizeLimits(working.limits);
  const launchPowerDbm = finiteOrNull(working.launch?.powerDbm);

  const nodes = Array.isArray(working.nodes) ? working.nodes : [];
  const results = [];
  let carried = launchPowerDbm;

  for (const node of nodes){
    const nodeId = String(node?.id || "");
    const type = String(node?.type || EBC_NODE_TYPE.PCOT);
    const span = computeSpan(node?.span, working);
    const upstreamDbm = carried;
    const inputDbm = upstreamDbm === null ? null : upstreamDbm - span.totalDb;

    const trace = [];
    trace.push({ label: results.length === 0 ? "Launch / upstream power" : "Upstream through power", kind: "power", valueDbm: upstreamDbm });
    trace.push(...spanTraceEntries(span));
    trace.push({ label: (node?.label || nodeId || "Location") + " input", kind: "result", valueDbm: inputDbm, divider: true });

    const base = {
      id: nodeId,
      label: String(node?.label || nodeId || "Location"),
      type,
      designedRatio: String(node?.designedRatio || "") || null,
      installedRatio: String(node?.installedRatio || "") || null,
      span,
      upstreamDbm: round2(upstreamDbm),
      inputDbm: round2(inputDbm),
      provenance: EBC_PROVENANCE.CALCULATED,
      measured: node?.measured || null,
      assumptions: span.assumptions.slice(),
    };

    if (type === EBC_NODE_TYPE.PCOT){
      results.push(computePcotNode({ node, base, trace, inputDbm, working, limits, specs, lossBasis, ratioOverrides }));
      carried = results[results.length - 1].throughOutputDbm === null
        ? null
        : results[results.length - 1].throughOutputRawDbm;
      continue;
    }

    if (type === EBC_NODE_TYPE.TERMINAL){
      const terminalLossDb = finiteOrNull(node?.terminalLossDb) ?? finiteOrNull(node?.dropLossDb) ?? 0;
      if (terminalLossDb > 0) trace.push({ label: "Terminal / drop loss", kind: "loss", valueDb: terminalLossDb });
      const receiveDbm = inputDbm === null ? null : inputDbm - terminalLossDb;
      trace.push({ label: "Delivered power", kind: "result", valueDbm: receiveDbm });
      const margin = marginFor(receiveDbm, limits);
      results.push({
        ...base,
        terminalLossDb,
        deliveredDbm: round2(receiveDbm),
        deliveredRawDbm: receiveDbm,
        throughOutputDbm: null,
        throughOutputRawDbm: null,
        tapOutputDbm: null,
        marginDb: margin.marginDb,
        status: margin.status,
        statusReason: margin.reason,
        statusCode: margin.code,
        trace,
      });
      carried = receiveDbm;
      continue;
    }

    // passive / reference: an explicitly recorded loss, or a documented
    // pass-through point that contributes nothing of its own.
    const passiveLossDb = finiteOrNull(node?.passiveLossDb) ?? 0;
    if (passiveLossDb > 0) trace.push({ label: "Passive device loss", kind: "loss", valueDb: passiveLossDb });
    const outputDbm = inputDbm === null ? null : inputDbm - passiveLossDb;
    trace.push({ label: "Output power", kind: "result", valueDbm: outputDbm });
    results.push({
      ...base,
      passiveLossDb,
      throughOutputDbm: round2(outputDbm),
      throughOutputRawDbm: outputDbm,
      tapOutputDbm: null,
      deliveredDbm: null,
      marginDb: null,
      status: EBC_STATUS.UNKNOWN,
      statusReason: "Pass-through location; no delivery point is evaluated here.",
      statusCode: "PASS_THROUGH",
      trace,
    });
    carried = outputDbm;
  }

  return finalize({ working, validation, limits, launchPowerDbm, results, lossBasis, specs, mode });
}

function computePcotNode({ node, base, trace, inputDbm, working, limits, specs, lossBasis, ratioOverrides }){
  const overrideRatio = ratioOverrides ? ratioOverrides[base.id] : null;
  const ratioUsed = String(overrideRatio || node?.installedRatio || node?.designedRatio || "").trim();
  const ratioSource = overrideRatio
    ? "OVERRIDE"
    : (node?.installedRatio ? "INSTALLED" : (node?.designedRatio ? "DESIGNED" : "NONE"));
  const parsed = parseRatio(ratioUsed);
  const spec = getPcotSpec(ratioUsed, specs);
  // The TDS tap figure is stated per splitter size, so the device's port count
  // is part of resolving its loss. Node 54 devices are 1x4.
  const portCount = finiteOrNull(node?.splitterRatio);
  const resolved = resolveInsertionLoss(spec, { lossBasis, portCount });

  if (!resolved.ok){
    trace.push({ label: "PCOT insertion loss", kind: "blocked", note: "No usable specification for " + (ratioUsed || "an unrecorded ratio") + "." });
    return {
      ...base,
      ratioUsed: ratioUsed || null,
      ratioSource,
      tapPercent: parsed ? parsed.tapPercent : null,
      throughPercent: parsed ? parsed.throughPercent : null,
      spec: spec || null,
      specUsable: false,
      specVerified: false,
      throughInsertionLossDb: null,
      tapInsertionLossDb: null,
      throughOutputDbm: null,
      throughOutputRawDbm: null,
      tapOutputDbm: null,
      tapDeliveredDbm: null,
      deliveredDbm: null,
      deliveredRawDbm: null,
      marginDb: null,
      status: EBC_STATUS.UNKNOWN,
      statusReason: "The PCOT specification for " + (ratioUsed || "this device") + " is not configured, so nothing downstream of it can be predicted.",
      statusCode: "MISSING_SPECIFICATION",
      trace,
    };
  }

  const basisLabel = resolved.basis === "max" ? "max" : "nominal";
  // Tap and through can now have different standing: TDS states the tap figure
  // but no through figure, so they are labelled independently.
  const verifiedLabel = resolved.verified ? "VERIFIED" : "UNVERIFIED";
  const tapLabel = resolved.tapVerified ? "TDS VERIFIED" : "UNVERIFIED";
  const throughLabel = resolved.throughVerified ? "VERIFIED" : "UNVERIFIED";

  const throughInsertionLossDb = resolved.throughLossDb;
  const tapInsertionLossDb = resolved.tapLossDb;
  const throughOutputDbm = inputDbm === null ? null : inputDbm - throughInsertionLossDb;
  const tapOutputDbm = inputDbm === null ? null : inputDbm - tapInsertionLossDb;

  trace.push({ label: "PCOT " + ratioUsed + " through loss (" + basisLabel + ", " + throughLabel + ")", kind: "loss", valueDb: throughInsertionLossDb });
  trace.push({ label: "Through output — continues downstream", kind: "result", valueDbm: throughOutputDbm, divider: true });
  trace.push({
    label: "PCOT " + ratioUsed + (portCount ? " 1x" + portCount : "") + " tap loss (" + basisLabel + ", " + tapLabel + ")",
    kind: "loss",
    valueDb: tapInsertionLossDb,
  });
  trace.push({ label: "Tap output", kind: "result", valueDbm: tapOutputDbm, divider: true });
  // The audit trace must be able to answer "where did this dB figure come
  // from?" without leaving the screen — separately for each figure, because
  // they no longer share a source.
  trace.push({
    label: "Tap loss source",
    kind: "note",
    note: tapLabel,
    provenance: resolved.tapProvenance || null,
    detail: resolved.tapProvenance ? describeProvenance(resolved.tapProvenance) : (spec?.source || "no source recorded"),
    sourceDetail: resolved.tapProvenance?.sourceDetail || "",
  });
  trace.push({
    label: "Through loss source",
    kind: "note",
    note: throughLabel,
    provenance: resolved.throughProvenance || null,
    detail: resolved.throughProvenance ? describeProvenance(resolved.throughProvenance) : (spec?.source || "no source recorded"),
    sourceDetail: resolved.throughProvenance?.sourceDetail || "",
  });

  const tapDrop = computeSpan(node?.tapDrop, working);
  const tapDropTraceEntries = spanTraceEntries(tapDrop, "Tap drop");
  const terminalLossDb = finiteOrNull(node?.tapDrop?.terminalLossDb) ?? finiteOrNull(node?.terminalLossDb) ?? 0;
  const hasTapDrop = tapDropTraceEntries.length > 0 || terminalLossDb > 0;
  let tapDeliveredDbm = tapOutputDbm;
  if (hasTapDrop && tapOutputDbm !== null){
    trace.push(...tapDropTraceEntries);
    if (terminalLossDb > 0) trace.push({ label: "Tap terminal / drop loss", kind: "loss", valueDb: terminalLossDb });
    tapDeliveredDbm = tapOutputDbm - tapDrop.totalDb - terminalLossDb;
    trace.push({ label: "Tap delivered at the terminal", kind: "result", valueDbm: tapDeliveredDbm, divider: true });
  }

  const margin = marginFor(tapDeliveredDbm, limits);

  return {
    ...base,
    ratioUsed,
    ratioSource,
    tapPercent: parsed ? parsed.tapPercent : null,
    throughPercent: parsed ? parsed.throughPercent : null,
    spec: spec || null,
    specUsable: true,
    specVerified: Boolean(resolved.verified),
    tapVerified: Boolean(resolved.tapVerified),
    throughVerified: Boolean(resolved.throughVerified),
    tapSource: resolved.tapSource || "",
    tapProvenance: resolved.tapProvenance || null,
    throughProvenance: resolved.throughProvenance || null,
    portCount,
    lossBasis: resolved.basis,
    throughInsertionLossDb,
    tapInsertionLossDb,
    throughOutputDbm: round2(throughOutputDbm),
    throughOutputRawDbm: throughOutputDbm,
    tapOutputDbm: round2(tapOutputDbm),
    tapOutputRawDbm: tapOutputDbm,
    tapDrop: hasTapDrop ? tapDrop : null,
    tapTerminalLossDb: terminalLossDb,
    tapDeliveredDbm: round2(tapDeliveredDbm),
    deliveredDbm: round2(tapDeliveredDbm),
    deliveredRawDbm: tapDeliveredDbm,
    marginDb: margin.marginDb,
    status: margin.status,
    statusReason: margin.reason,
    statusCode: margin.code,
    trace,
  };
}

function marginFor(powerDbm, limits){
  if (powerDbm === null || limits.receiverMinDbm === null){
    const classified = classifyMargin(null, limits);
    return { marginDb: null, status: classified.status, reason: classified.reason, code: classified.code };
  }
  const marginDb = powerDbm - limits.receiverMinDbm;
  const classified = classifyMargin(marginDb, {
    engineeringReserveDb: limits.engineeringReserveDb,
    powerDbm,
    receiverMaxDbm: limits.receiverMaxDbm,
  });
  return { marginDb: round2(marginDb), status: classified.status, reason: classified.reason, code: classified.code };
}

const STATUS_RANK = { PASS: 0, MARGINAL: 1, UNKNOWN: 2, FAIL: 3 };

function finalize({ working, validation, limits, launchPowerDbm, results, lossBasis, specs, mode }){
  const delivering = results.filter((node) => node.marginDb !== null);
  const weakest = delivering.length
    ? delivering.reduce((worst, node) => (node.marginDb < worst.marginDb ? node : worst))
    : null;

  const last = results.length ? results[results.length - 1] : null;
  const endPower = last
    ? (last.deliveredRawDbm !== null && last.deliveredRawDbm !== undefined ? last.deliveredRawDbm : last.throughOutputRawDbm)
    : null;
  const endMargin = marginFor(endPower === undefined ? null : endPower, limits);

  const statuses = results.map((node) => node.status);
  let overall = EBC_STATUS.UNKNOWN;
  if (!validation.ok){
    overall = EBC_STATUS.UNKNOWN;
  } else if (statuses.length){
    overall = statuses.reduce((worst, status) => (STATUS_RANK[status] > STATUS_RANK[worst] ? status : worst), EBC_STATUS.PASS);
  }

  const unverifiedRatios = [...new Set(results
    .filter((node) => node.type === EBC_NODE_TYPE.PCOT && node.specUsable && !node.specVerified)
    .map((node) => node.ratioUsed))];

  const dataQuality = assessDataQuality({ working, results, unverifiedRatios, validation });

  return Object.freeze({
    ok: validation.ok,
    mode,
    lossBasis,
    legId: String(working.legId || ""),
    label: String(working.label || ""),
    projectId: String(working.projectId || ""),
    nodeName: String(working.nodeName || ""),
    wavelengthNm: finiteOrNull(working.wavelengthNm),
    launchPowerDbm: round2(launchPowerDbm),
    limits,
    nodes: Object.freeze(results),
    weakest: weakest ? Object.freeze({ nodeId: weakest.id, label: weakest.label, marginDb: weakest.marginDb, status: weakest.status }) : null,
    endOfLeg: Object.freeze({
      nodeId: last ? last.id : "",
      label: last ? last.label : "",
      powerDbm: round2(endPower === undefined ? null : endPower),
      marginDb: endMargin.marginDb,
      status: endMargin.status,
    }),
    status: overall,
    validation,
    confidence: validation.confidence,
    specsVerified: unverifiedRatios.length === 0,
    unverifiedRatios: Object.freeze(unverifiedRatios),
    dataQuality,
    preliminary: dataQuality.preliminary,
    provenance: EBC_PROVENANCE.CALCULATED,
  });
}

/**
 * Classify what a result is actually built from.
 *
 * The rule is deliberately blunt: if ANY device loss in the cascade is an
 * estimate rather than a verified specification, the whole result is
 * PRELIMINARY. A budget is only as approved as its weakest input, and a
 * technician must never have to work that out for themselves.
 */
function assessDataQuality({ working, results, unverifiedRatios, validation }){
  const pcots = results.filter((node) => node.type === EBC_NODE_TYPE.PCOT);
  const estimatedLoss = pcots.filter((node) => node.specUsable && !node.specVerified);
  const missingSpec = pcots.filter((node) => node.specUsable === false);
  // Tap and through are sourced independently now, so report precisely which
  // half is unverified rather than condemning both.
  const estimatedTap = pcots.filter((node) => node.specUsable && !node.tapVerified);
  const estimatedThrough = pcots.filter((node) => node.specUsable && !node.throughVerified);
  const tdsTapCount = pcots.filter((node) => node.tapSource === "TDS_PRICELIST").length;

  const designInputs = [];
  const estimateInputs = [];
  const fieldInputs = [];

  for (const node of results){
    if (node.span && node.span.distance !== null){
      const source = (working.nodes || []).find((item) => item.id === node.id);
      const distanceSource = source?.span?.distanceSource || "";
      (distanceSource ? designInputs : estimateInputs).push({
        nodeId: node.id, field: "span.distance",
        label: node.label + " span distance",
        dataClass: distanceSource ? EBC_DATA_CLASS.DESIGN_DATA : EBC_DATA_CLASS.ESTIMATE,
        detail: distanceSource || "Entered in the EBC; no design source recorded.",
      });
    }
    if (node.measured && Object.values(node.measured).some((value) => value !== null && value !== "" && value !== undefined)){
      fieldInputs.push({ nodeId: node.id, field: "measured", label: node.label + " meter readings", dataClass: EBC_DATA_CLASS.FIELD_DATA, detail: "Recorded by a technician." });
    }
  }

  for (const node of pcots){
    if (node.specUsable === false) continue;
    if (node.tapVerified){
      designInputs.push({
        nodeId: node.id, field: "pcot.tapLoss",
        label: node.label + " " + node.ratioUsed + " tap loss",
        dataClass: EBC_DATA_CLASS.ENGINEERING_CONSTANT,
        detail: node.tapProvenance ? describeProvenance(node.tapProvenance) : "Verified specification.",
      });
    } else {
      estimateInputs.push({
        nodeId: node.id, field: "pcot.tapLoss",
        label: node.label + " " + node.ratioUsed + " tap loss",
        dataClass: EBC_DATA_CLASS.ESTIMATE,
        detail: node.tapProvenance ? describeProvenance(node.tapProvenance) : "Unverified specification.",
      });
    }
    if (!node.throughVerified){
      estimateInputs.push({
        nodeId: node.id, field: "pcot.throughLoss",
        label: node.label + " " + node.ratioUsed + " through loss",
        dataClass: EBC_DATA_CLASS.ESTIMATE,
        detail: node.throughProvenance ? describeProvenance(node.throughProvenance) : "Unverified specification.",
      });
    }
  }

  const reasons = [];
  if (estimatedTap.length){
    reasons.push("PCOT tap loss for " + [...new Set(estimatedTap.map((n) => n.ratioUsed))].join(", ") + " is an unverified estimate, not a manufacturer specification.");
  }
  if (estimatedThrough.length){
    reasons.push("PCOT through loss for " + [...new Set(estimatedThrough.map((n) => n.ratioUsed))].join(", ") + " is an unverified estimate. TDS states a tap figure for these devices but no through figure.");
  }
  if (missingSpec.length){
    reasons.push(missingSpec.length + " location(s) have no configured PCOT specification at all.");
  }
  if (!validation.ok){
    reasons.push("Required engineering inputs are missing.");
  }

  return Object.freeze({
    preliminary: reasons.length > 0,
    reasons: Object.freeze(reasons),
    headline: reasons.length
      ? (estimatedTap.length || estimatedThrough.length
          ? (estimatedTap.length
              ? "PRELIMINARY — USING UNVERIFIED PCOT LOSS DATA"
              : "PRELIMINARY — TAP LOSS IS TDS VERIFIED, THROUGH LOSS IS NOT")
          : "PRELIMINARY — INCOMPLETE ENGINEERING DATA")
      : "ENGINEERING APPROVED INPUTS",
    unverifiedRatios: Object.freeze(unverifiedRatios),
    tdsVerifiedTapCount: tdsTapCount,
    counts: Object.freeze({
      designData: designInputs.filter((item) => item.dataClass === EBC_DATA_CLASS.DESIGN_DATA).length,
      fieldData: fieldInputs.length,
      engineeringConstants: designInputs.filter((item) => item.dataClass === EBC_DATA_CLASS.ENGINEERING_CONSTANT).length,
      estimates: estimateInputs.length,
    }),
    inputs: Object.freeze([...designInputs, ...fieldInputs, ...estimateInputs]),
  });
}

/** Convenience lookup used by the UI and by the recommendation engine. */
export function findNodeResult(result, nodeId){
  return (result?.nodes || []).find((node) => node.id === String(nodeId)) || null;
}

/** Every node strictly downstream of nodeId, in cascade order. */
export function downstreamNodes(result, nodeId){
  const nodes = result?.nodes || [];
  const index = nodes.findIndex((node) => node.id === String(nodeId));
  if (index < 0) return [];
  return nodes.slice(index + 1);
}

/**
 * Render an audit trace as fixed-width text, which is what the
 * "Show Calculation" panel and any exported report use.
 */
export function formatTrace(trace = [], { width = 38 } = {}){
  const lines = [];
  for (const entry of trace){
    if (entry.kind === "blocked" || entry.kind === "note"){
      lines.push(pad(entry.label, width) + "  " + (entry.note || "not available"));
      if (entry.detail) lines.push(pad("  source", width) + "  " + entry.detail);
      if (entry.sourceDetail) lines.push(pad("  detail", width) + "  " + entry.sourceDetail);
      continue;
    }
    if (entry.kind === "loss"){
      const value = entry.valueDb === null ? "n/a" : "-" + Number(entry.valueDb).toFixed(2) + " dB";
      lines.push(pad(entry.label, width) + value.padStart(12));
      continue;
    }
    const value = entry.valueDbm === null || entry.valueDbm === undefined ? "n/a" : Number(entry.valueDbm).toFixed(2) + " dBm";
    if (entry.divider) lines.push("-".repeat(width + 12));
    lines.push(pad(entry.label, width) + value.padStart(12));
  }
  return lines.join("\n");
}

function pad(text, width){
  const value = String(text ?? "");
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}

export { EBC_CONFIDENCE };
