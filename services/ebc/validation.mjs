/**
 * EBC — input validation.
 *
 * The point of this module is to make the EBC say exactly what is missing
 * instead of producing a confident-looking number from incomplete inputs.
 *
 * Severity contract:
 *   blocking  — the engine must not publish a margin or a recommendation.
 *   warning   — the engine may calculate, but confidence is degraded and the
 *               UI has to show the caveat.
 */

import { finiteOrNull, getPcotSpec, isRatioCoherent, parseRatio, resolveInsertionLoss } from "./pcotSpecs.mjs";

export const EBC_SEVERITY = Object.freeze({ BLOCKING: "blocking", WARNING: "warning" });

export const EBC_CONFIDENCE = Object.freeze({
  HIGH: "HIGH",
  MEDIUM: "MEDIUM",
  LOW: "LOW",
  INSUFFICIENT: "INSUFFICIENT",
});

/** Physically plausible optical power window for this kind of plant, in dBm. */
export const PLAUSIBLE_POWER_DBM = Object.freeze({ min: -80, max: 30 });

/** Loss fields that must never be negative — a negative loss is a gain. */
const SPAN_LOSS_FIELDS = ["spliceLossDb", "connectorLossDb", "extraLossDb", "terminalLossDb", "dropLossDb"];

function issue(severity, code, message, extra = {}){
  return Object.freeze({ severity, code, message, nodeId: "", field: "", ...extra });
}

function checkNonNegativeLoss(container, path, nodeId, out){
  if (!container) return;
  for (const field of SPAN_LOSS_FIELDS){
    const value = finiteOrNull(container[field]);
    if (value === null) continue;
    if (value < 0){
      out.push(issue(
        EBC_SEVERITY.BLOCKING,
        "NEGATIVE_LOSS_AS_GAIN",
        "A passive loss was entered as a negative number (" + value + " dB) at " + path + ". Passive plant cannot add power. Enter loss as a positive dB value.",
        { nodeId, field: path + "." + field },
      ));
    }
  }
}

function checkSpan(span, path, nodeId, out, leg){
  if (!span) return;
  const distance = finiteOrNull(span.distance);
  if (distance !== null && distance < 0){
    out.push(issue(EBC_SEVERITY.BLOCKING, "NEGATIVE_DISTANCE",
      "Fiber distance at " + path + " is negative (" + distance + "). Distance cannot be less than zero.",
      { nodeId, field: path + ".distance" }));
  }
  const attenuation = finiteOrNull(leg?.fiber?.attenuationDbPerKm) ?? finiteOrNull(leg?.fiber?.attenuationDbPerMile);
  if (attenuation !== null && attenuation < 0){
    out.push(issue(EBC_SEVERITY.BLOCKING, "NEGATIVE_ATTENUATION",
      "Fiber attenuation coefficient is negative (" + attenuation + "). Fiber cannot add power.",
      { nodeId, field: "fiber.attenuation" }));
  }
  if (distance !== null && distance > 0 && attenuation === null){
    out.push(issue(EBC_SEVERITY.WARNING, "MISSING_ATTENUATION",
      "A fiber distance is entered at " + path + " but no attenuation coefficient is set for this leg, so fiber loss is being counted as 0 dB.",
      { nodeId, field: "fiber.attenuation" }));
  }
  if (distance === null && attenuation !== null){
    out.push(issue(EBC_SEVERITY.WARNING, "MISSING_DISTANCE",
      "No fiber distance is recorded for " + path + ", so span loss for this hop is counted as 0 dB. The predicted power downstream of it is optimistic.",
      { nodeId, field: path + ".distance" }));
  }
  const counts = [["spliceCount", "splice"], ["connectorCount", "connector"]];
  for (const [field, label] of counts){
    const count = finiteOrNull(span[field]);
    if (count !== null && (count < 0 || !Number.isInteger(count))){
      out.push(issue(EBC_SEVERITY.BLOCKING, "INVALID_COMPONENT_COUNT",
        "The " + label + " count at " + path + " must be a whole number of zero or more (received " + count + ").",
        { nodeId, field: path + "." + field }));
    }
  }
  checkNonNegativeLoss(span, path, nodeId, out);
}

/**
 * Validate a leg definition.
 * `mode` is "design" or "field"; field mode additionally sanity-checks readings.
 */
export function validateLeg(leg, { specs, lossBasis = "nominal", mode = "design", strictWavelength = false } = {}){
  const out = [];

  if (!leg || typeof leg !== "object"){
    return summarize([issue(EBC_SEVERITY.BLOCKING, "NO_LEG", "No leg definition was supplied to the calculator.")]);
  }

  const nodes = Array.isArray(leg.nodes) ? leg.nodes : [];
  if (!nodes.length){
    out.push(issue(EBC_SEVERITY.BLOCKING, "NO_NODES", "This leg has no PCOT or terminal locations, so there is nothing to calculate."));
  }

  // --- Launch / upstream power -------------------------------------------
  const launchPower = finiteOrNull(leg.launch?.powerDbm);
  if (launchPower === null){
    out.push(issue(EBC_SEVERITY.BLOCKING, "MISSING_UPSTREAM_POWER",
      "Upstream launch power is missing. Enter the OLT/node launch power, or the measured power at the head of this leg, before the EBC can predict anything downstream.",
      { field: "launch.powerDbm" }));
  } else if (launchPower < PLAUSIBLE_POWER_DBM.min || launchPower > PLAUSIBLE_POWER_DBM.max){
    out.push(issue(EBC_SEVERITY.BLOCKING, "IMPLAUSIBLE_LAUNCH_POWER",
      "Launch power of " + launchPower + " dBm is outside the plausible range of " + PLAUSIBLE_POWER_DBM.min + " to " + PLAUSIBLE_POWER_DBM.max + " dBm. Check the units.",
      { field: "launch.powerDbm" }));
  }

  // --- Engineering limits -------------------------------------------------
  const receiverMin = finiteOrNull(leg.limits?.receiverMinDbm);
  const receiverMax = finiteOrNull(leg.limits?.receiverMaxDbm);
  if (receiverMin === null){
    out.push(issue(EBC_SEVERITY.BLOCKING, "UNKNOWN_ENGINEERING_LIMITS",
      "No minimum required receive power is configured for this leg, so engineering margin and PASS/MARGINAL/FAIL cannot be determined.",
      { field: "limits.receiverMinDbm" }));
  }
  if (receiverMin !== null && receiverMax !== null && receiverMax < receiverMin){
    out.push(issue(EBC_SEVERITY.BLOCKING, "INVERTED_RECEIVER_LIMITS",
      "The receiver maximum (" + receiverMax + " dBm) is below the receiver minimum (" + receiverMin + " dBm).",
      { field: "limits.receiverMaxDbm" }));
  }
  const reserve = finiteOrNull(leg.limits?.engineeringReserveDb);
  if (reserve !== null && reserve < 0){
    out.push(issue(EBC_SEVERITY.BLOCKING, "NEGATIVE_RESERVE",
      "Engineering reserve cannot be negative (" + reserve + " dB).",
      { field: "limits.engineeringReserveDb" }));
  }
  if (reserve === null){
    out.push(issue(EBC_SEVERITY.WARNING, "MISSING_RESERVE",
      "No engineering reserve is configured. PASS is being judged against the bare receiver minimum with no design headroom.",
      { field: "limits.engineeringReserveDb" }));
  }

  // --- Wavelength ---------------------------------------------------------
  const legWavelength = finiteOrNull(leg.wavelengthNm);
  if (legWavelength === null){
    out.push(issue(EBC_SEVERITY.WARNING, "MISSING_WAVELENGTH",
      "No design wavelength is set for this leg. Loss values are wavelength dependent and cannot be checked against the PCOT specification.",
      { field: "wavelengthNm" }));
  }

  // --- Per node -----------------------------------------------------------
  for (const node of nodes){
    const nodeId = String(node?.id || "");
    const label = String(node?.label || nodeId || "an unnamed location");
    checkSpan(node?.span, label + " span", nodeId, out, leg);
    checkNonNegativeLoss(node, label, nodeId, out);
    if (node?.tapDrop) checkSpan(node.tapDrop, label + " tap drop", nodeId, out, leg);

    if (node?.type !== "pcot") continue;

    const ratio = String(node.installedRatio || node.designedRatio || "").trim();
    if (!ratio){
      out.push(issue(EBC_SEVERITY.BLOCKING, "MISSING_PCOT_RATIO",
        "No designed or installed PCOT ratio is recorded for " + label + ".",
        { nodeId, field: "installedRatio" }));
      continue;
    }
    const parsed = parseRatio(ratio);
    if (!parsed){
      out.push(issue(EBC_SEVERITY.BLOCKING, "UNREADABLE_PCOT_RATIO",
        "The PCOT ratio " + ratio + " at " + label + " is not in through/tap form, for example 90/10.",
        { nodeId, field: "installedRatio" }));
      continue;
    }
    if (!isRatioCoherent(ratio)){
      out.push(issue(EBC_SEVERITY.BLOCKING, "INCOHERENT_PCOT_RATIO",
        "The PCOT ratio " + ratio + " at " + label + " does not make sense: through " + parsed.throughPercent + "% plus tap " + parsed.tapPercent + "% is " + (parsed.throughPercent + parsed.tapPercent) + "%, not 100%.",
        { nodeId, field: "installedRatio" }));
      continue;
    }

    const spec = getPcotSpec(ratio, specs);
    const resolved = resolveInsertionLoss(spec, { lossBasis });
    if (!resolved.ok){
      const reason = resolved.reason === "missing_max_insertion_loss"
        ? "worst-case insertion loss is not configured for " + ratio + ", and a worst-case budget must not fall back to typical values"
        : "no insertion-loss specification is configured for " + ratio;
      out.push(issue(EBC_SEVERITY.BLOCKING, "MISSING_PCOT_SPECIFICATION",
        "Cannot budget through " + label + ": " + reason + ". Enter the manufacturer values in the PCOT specification table first.",
        { nodeId, field: "spec." + ratio }));
      continue;
    }
    if (!spec.verified){
      out.push(issue(EBC_SEVERITY.WARNING, "UNVERIFIED_PCOT_SPECIFICATION",
        "The " + ratio + " insertion-loss values used for " + label + " are UNVERIFIED (" + spec.source + "). They are not engineering approved until confirmed against the manufacturer data sheet.",
        { nodeId, field: "spec." + ratio }));
    }
    const specWavelength = finiteOrNull(spec.wavelengthNm);
    if (legWavelength !== null && specWavelength !== null && specWavelength !== legWavelength){
      out.push(issue(
        strictWavelength ? EBC_SEVERITY.BLOCKING : EBC_SEVERITY.WARNING,
        "WAVELENGTH_SPEC_MISMATCH",
        "The " + ratio + " specification at " + label + " is stated at " + specWavelength + " nm but this leg is designed at " + legWavelength + " nm.",
        { nodeId, field: "spec." + ratio },
      ));
    }

    const designed = String(node.designedRatio || "").trim();
    const installed = String(node.installedRatio || "").trim();
    if (designed && installed && designed !== installed){
      out.push(issue(EBC_SEVERITY.WARNING, "DESIGNED_INSTALLED_RATIO_MISMATCH",
        "At " + label + " the designed ratio is " + designed + " but the installed ratio is recorded as " + installed + ". The EBC is budgeting the installed device.",
        { nodeId, field: "installedRatio" }));
    }

    if (mode === "field") validateMeasurements(node, label, nodeId, legWavelength, out);
  }

  return summarize(out);
}

function validateMeasurements(node, label, nodeId, legWavelength, out){
  const measured = node?.measured || null;
  if (!measured) return;
  for (const field of ["inputDbm", "throughDbm", "tapDbm"]){
    const value = finiteOrNull(measured[field]);
    if (value === null) continue;
    if (value < PLAUSIBLE_POWER_DBM.min || value > PLAUSIBLE_POWER_DBM.max){
      out.push(issue(EBC_SEVERITY.BLOCKING, "IMPLAUSIBLE_MEASUREMENT",
        "The measured " + field.replace("Dbm", "") + " at " + label + " is " + value + " dBm, outside the plausible " + PLAUSIBLE_POWER_DBM.min + " to " + PLAUSIBLE_POWER_DBM.max + " dBm range. Check the meter units.",
        { nodeId, field: "measured." + field }));
    }
  }
  const measuredWavelength = finiteOrNull(measured.wavelengthNm);
  if (legWavelength !== null && measuredWavelength !== null && measuredWavelength !== legWavelength){
    out.push(issue(EBC_SEVERITY.WARNING, "MEASUREMENT_WAVELENGTH_MISMATCH",
      "Readings at " + label + " were taken at " + measuredWavelength + " nm but the leg is designed at " + legWavelength + " nm. Loss differs by wavelength, so the comparison is indicative only.",
      { nodeId, field: "measured.wavelengthNm" }));
  }
  const input = finiteOrNull(measured.inputDbm);
  const through = finiteOrNull(measured.throughDbm);
  const tap = finiteOrNull(measured.tapDbm);
  if (input !== null && through !== null && through > input + 0.05){
    out.push(issue(EBC_SEVERITY.WARNING, "MEASURED_THROUGH_ABOVE_INPUT",
      "The measured through at " + label + " (" + through + " dBm) is higher than the measured input (" + input + " dBm). A passive tap cannot add power — check which port is which, or the direction of test.",
      { nodeId, field: "measured.throughDbm" }));
  }
  if (input !== null && tap !== null && tap > input + 0.05){
    out.push(issue(EBC_SEVERITY.WARNING, "MEASURED_TAP_ABOVE_INPUT",
      "The measured tap at " + label + " (" + tap + " dBm) is higher than the measured input (" + input + " dBm). Check the port identification and test direction.",
      { nodeId, field: "measured.tapDbm" }));
  }
}

function summarize(issues){
  const blocking = issues.filter((item) => item.severity === EBC_SEVERITY.BLOCKING);
  const warnings = issues.filter((item) => item.severity === EBC_SEVERITY.WARNING);
  return Object.freeze({
    ok: blocking.length === 0,
    blocking: Object.freeze(blocking),
    warnings: Object.freeze(warnings),
    issues: Object.freeze(issues),
    confidence: deriveConfidence(blocking, warnings),
    missingSummary: Object.freeze(blocking.map((item) => item.message)),
  });
}

const CONFIDENCE_DEGRADING = new Set([
  "MISSING_DISTANCE", "MISSING_ATTENUATION", "MISSING_WAVELENGTH",
  "MISSING_RESERVE", "UNVERIFIED_PCOT_SPECIFICATION", "WAVELENGTH_SPEC_MISMATCH",
]);

export function deriveConfidence(blocking, warnings){
  if (blocking.length) return EBC_CONFIDENCE.INSUFFICIENT;
  const degrading = warnings.filter((item) => CONFIDENCE_DEGRADING.has(item.code));
  if (!degrading.length) return EBC_CONFIDENCE.HIGH;
  const unverified = degrading.some((item) => item.code === "UNVERIFIED_PCOT_SPECIFICATION");
  const structural = degrading.some((item) => item.code === "MISSING_DISTANCE" || item.code === "MISSING_ATTENUATION");
  if (unverified && structural) return EBC_CONFIDENCE.LOW;
  return EBC_CONFIDENCE.MEDIUM;
}
