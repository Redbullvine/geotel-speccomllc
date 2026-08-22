/**
 * EBC — PCOT specification model.
 *
 * IMPORTANT ENGINEERING NOTE
 * --------------------------
 * This repository does not contain a manufacturer technical data sheet for any
 * PCOT installed on Node 54. The only optical loss figures that exist in the
 * codebase are NODE54_TAP_RATIO_ESTIMATES in services/node54Diagnostics.mjs,
 * which that file explicitly describes as "engineering/production-code design
 * references, not manufacturer data sheets".
 *
 * Those figures are therefore imported here as UNVERIFIED seed values. They are
 * enough to reason about a leg in the field; they are NOT engineering approved.
 * Ratios with no figure at all are deliberately left null and are refused by
 * the engine until somebody configures them, rather than being filled in with a
 * plausible guess.
 *
 * Ratio convention: "90/10" means 90% THROUGH / 10% TAP. This matches the
 * seeded loss values (90/10 has the lowest through loss and the highest tap
 * loss) and the HxFO(1X4)PCOT(ratio)MO production codes recorded for Node 54.
 */

import { NODE54_TAP_RATIO_ESTIMATES } from "../node54Diagnostics.mjs";
import { NODE54_TDS_PART_NUMBERS } from "./node54TdsDesign.mjs";
import {
  EBC_DATA_CLASS,
  EBC_LOSS_PROVENANCE,
  EBC_VERIFICATION,
  declareConstant,
  isVerifiedLevel,
} from "./engineeringConstants.mjs";
import { tdsTapLossConstant } from "./tdsPricelist.mjs";

export const PCOT_SPEC_STATUS = Object.freeze({
  /** Values transcribed from a manufacturer TDS and marked verified. */
  VERIFIED: "VERIFIED",
  /** Values exist but nobody has confirmed them against a data sheet. */
  UNVERIFIED: "UNVERIFIED",
  /** No usable loss values at all. The engine refuses to budget through this. */
  SPECIFICATION_REQUIRED: "SPECIFICATION_REQUIRED",
});

export const PCOT_SPEC_SOURCE = Object.freeze({
  MANUFACTURER_TDS: "MANUFACTURER_TDS",
  REPO_ESTIMATE: "REPO_ESTIMATE",
  THEORETICAL_SPLIT: "THEORETICAL_SPLIT",
  USER_CONFIGURED: "USER_CONFIGURED",
  NONE: "NONE",
});

/** Every ratio the EBC is expected to know about, least to most aggressive tap. */
export const PCOT_RATIOS = Object.freeze([
  "95/5", "90/10", "85/15", "80/20", "75/25",
  "70/30", "65/35", "60/40", "55/45", "50/50",
]);

const REPO_ESTIMATE_NOTE =
  "SpecCom Node 54 diagnostic estimates (services/node54Diagnostics.mjs). " +
  "Described in source as engineering/production-code design references, not a manufacturer data sheet.";

/**
 * Split "90/10" into through/tap percentages.
 * Returns null when the string is not a usable ratio.
 */
export function parseRatio(ratio){
  const raw = String(ratio || "").trim();
  const match = /^(\d{1,3})\s*\/\s*(\d{1,3})$/.exec(raw);
  if (!match) return null;
  const throughPercent = Number(match[1]);
  const tapPercent = Number(match[2]);
  if (!Number.isFinite(throughPercent) || !Number.isFinite(tapPercent)) return null;
  return { ratio: throughPercent + "/" + tapPercent, throughPercent, tapPercent };
}

/** A ratio is coherent only when the two legs of the split add up to 100%. */
export function isRatioCoherent(ratio){
  const parsed = parseRatio(ratio);
  if (!parsed) return false;
  if (parsed.throughPercent <= 0 || parsed.tapPercent <= 0) return false;
  return parsed.throughPercent + parsed.tapPercent === 100;
}

/**
 * Ideal (lossless) split loss for a percentage. This is arithmetic, not a
 * specification: it excludes excess loss, connector loss and manufacturing
 * tolerance, so a real device always loses more than this. Exposed so the UI
 * can show an absolute best case, never as engineering data.
 */
export function theoreticalSplitLossDb(percent){
  const value = Number(percent);
  if (!Number.isFinite(value) || value <= 0 || value > 100) return null;
  return Number((-10 * Math.log10(value / 100)).toFixed(2));
}

function buildSeedSpec(ratio){
  const parsed = parseRatio(ratio);
  const estimate = NODE54_TAP_RATIO_ESTIMATES[ratio] || null;
  const hasValues = Boolean(estimate);
  // The TDS project export names the part actually specified for each ratio.
  // That fixes WHICH device to pull a data sheet for; it carries no dB value,
  // so knowing the part number does not make the spec verified.
  const partNumber = NODE54_TDS_PART_NUMBERS[ratio] || "";
  return Object.freeze({
    ratio,
    throughPercent: parsed ? parsed.throughPercent : null,
    tapPercent: parsed ? parsed.tapPercent : null,
    nominalThroughLossDb: hasValues ? estimate.throughLossDb : null,
    nominalTapLossDb: hasValues ? estimate.tapLossDb : null,
    maxThroughInsertionLossDb: null,
    maxTapInsertionLossDb: null,
    // Unknown: the TDS material code is a catalogue unit, not a manufacturer.
    manufacturer: "",
    model: partNumber,
    modelSource: partNumber ? "TDS_PROJECT_EXPORT" : "",
    wavelengthNm: hasValues ? 1550 : null,
    source: hasValues ? PCOT_SPEC_SOURCE.REPO_ESTIMATE : PCOT_SPEC_SOURCE.NONE,
    reference: hasValues ? REPO_ESTIMATE_NOTE : "No loss values are present in this repository for this ratio.",
    verified: false,
    status: hasValues ? PCOT_SPEC_STATUS.UNVERIFIED : PCOT_SPEC_STATUS.SPECIFICATION_REQUIRED,
    // Full provenance for each loss figure, so the UI can answer "where did
    // this number come from?" for any value on screen.
    verification: hasValues ? EBC_VERIFICATION.REPO_ESTIMATE : EBC_VERIFICATION.UNKNOWN,
    dataClass: EBC_DATA_CLASS.ESTIMATE,
    provenance: hasValues
      ? EBC_LOSS_PROVENANCE[ratio] || null
      : Object.freeze({
          through: declareConstant({ key: "loss." + ratio + ".through", label: ratio + " through loss", units: "dB", notes: "No value exists in any available source for this ratio." }),
          tap: declareConstant({ key: "loss." + ratio + ".tap", label: ratio + " tap loss", units: "dB", notes: "No value exists in any available source for this ratio." }),
        }),
  });
}

/** The specification set the app boots with. Frozen; configure() returns a copy. */
export const DEFAULT_PCOT_SPECS = Object.freeze(
  Object.fromEntries(PCOT_RATIOS.map((ratio) => [ratio, buildSeedSpec(ratio)])),
);

export function listPcotSpecs(specs = DEFAULT_PCOT_SPECS){
  return PCOT_RATIOS.map((ratio) => specs[ratio]).filter(Boolean);
}

export function getPcotSpec(ratio, specs = DEFAULT_PCOT_SPECS){
  const parsed = parseRatio(ratio);
  if (!parsed) return null;
  return specs[parsed.ratio] || null;
}

/**
 * Coerce to a finite number or null.
 * Deliberately not `Number(value)`: Number(null) and Number("") are 0, which is
 * a finite number and would let an unspecified loss read as a real 0 dB loss.
 */
export function finiteOrNull(value){
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

/** True when the engine is allowed to budget a leg through this device. */
export function isSpecUsable(spec){
  return Boolean(spec)
    && finiteOrNull(spec.nominalThroughLossDb) !== null
    && finiteOrNull(spec.nominalTapLossDb) !== null;
}

/**
 * Resolve the loss pair the engine should use.
 * lossBasis "nominal" uses the typical figures; "max" uses worst-case insertion
 * loss and refuses to fall back to nominal, because a worst-case budget built
 * from typical numbers is not a worst-case budget.
 */
/**
 * Resolve the loss pair, preferring the TDS-stated tap figure when the device's
 * splitter size is known.
 *
 * TDS states the tap loss per splitter size (a 1x4 90/10 taps 19 dB to each
 * drop, a 1x2 90/10 taps 15 dB), so the figure is only applicable when the
 * port count is known. When it is not, the seeded repository estimate is used
 * unchanged and stays flagged as an estimate — the TDS number is not applied
 * to a device whose size has not been established.
 *
 * Through loss is never TDS-sourced: the pricelist does not state one.
 */
export function resolveInsertionLoss(spec, { lossBasis = "nominal", portCount = null } = {}){
  if (!spec) return { ok: false, reason: "missing_spec", throughLossDb: null, tapLossDb: null, basis: lossBasis };

  const tdsTap = portCount === null || portCount === undefined
    ? null
    : tdsTapLossConstant(portCount, spec.ratio);
  if (lossBasis === "max"){
    const throughLossDb = finiteOrNull(spec.maxThroughInsertionLossDb);
    const tapLossDb = finiteOrNull(spec.maxTapInsertionLossDb);
    if (throughLossDb === null || tapLossDb === null){
      return { ok: false, reason: "missing_max_insertion_loss", throughLossDb: null, tapLossDb: null, basis: "max" };
    }
    return { ok: true, reason: "", throughLossDb, tapLossDb, basis: "max", verified: Boolean(spec.verified) };
  }
  // A TDS tap figure alone is not enough to budget a leg: the cascade also
  // needs a through loss, and TDS does not state one.
  const throughLossDb = finiteOrNull(spec.nominalThroughLossDb);
  if (throughLossDb === null || (tdsTap === null && finiteOrNull(spec.nominalTapLossDb) === null)){
    return { ok: false, reason: "missing_spec_values", throughLossDb: null, tapLossDb: null, basis: "nominal" };
  }
  return {
    ok: true,
    reason: "",
    throughLossDb,
    tapLossDb: tdsTap ? tdsTap.value : finiteOrNull(spec.nominalTapLossDb),
    basis: "nominal",
    // The spec as a whole is only verified when BOTH figures are verified.
    // A TDS tap loss paired with an estimated through loss is not approved.
    verified: Boolean(spec.verified),
    tapSource: tdsTap ? "TDS_PRICELIST" : (spec.verified ? "SPEC" : "REPO_ESTIMATE"),
    tapVerified: tdsTap ? true : Boolean(spec.verified),
    throughVerified: Boolean(spec.verified),
    tapProvenance: tdsTap || (spec.provenance ? spec.provenance.tap : null),
    throughProvenance: spec.provenance ? spec.provenance.through : null,
  };
}

const REQUIRED_FOR_VERIFICATION = [
  "nominalThroughLossDb", "nominalTapLossDb",
  "maxThroughInsertionLossDb", "maxTapInsertionLossDb",
];

/**
 * Insert real manufacturer values. Returns a NEW specification set; the
 * original is never mutated, so an in-flight calculation cannot change under
 * the user. `verified: true` is only honoured when the record is complete
 * enough to defend: all four loss figures, a manufacturer, a model and a
 * wavelength.
 */
export function configurePcotSpec(specs, ratio, values = {}){
  const parsed = parseRatio(ratio);
  if (!parsed) throw new Error("configurePcotSpec: " + String(ratio) + " is not a usable PCOT ratio.");
  const base = (specs && specs[parsed.ratio]) || buildSeedSpec(parsed.ratio);
  const merged = {
    ...base,
    ...values,
    ratio: parsed.ratio,
    throughPercent: parsed.throughPercent,
    tapPercent: parsed.tapPercent,
  };

  const complete = REQUIRED_FOR_VERIFICATION.every((key) => finiteOrNull(merged[key]) !== null)
    && String(merged.manufacturer || "").trim() !== ""
    && String(merged.model || "").trim() !== ""
    && finiteOrNull(merged.wavelengthNm) !== null;

  merged.verified = Boolean(values.verified) && complete;
  if (merged.verified){
    merged.status = PCOT_SPEC_STATUS.VERIFIED;
    merged.source = values.source || PCOT_SPEC_SOURCE.MANUFACTURER_TDS;
  } else if (isSpecUsable(merged)){
    merged.status = PCOT_SPEC_STATUS.UNVERIFIED;
    merged.source = values.source || (base.source === PCOT_SPEC_SOURCE.NONE ? PCOT_SPEC_SOURCE.USER_CONFIGURED : base.source);
  } else {
    merged.status = PCOT_SPEC_STATUS.SPECIFICATION_REQUIRED;
    merged.source = PCOT_SPEC_SOURCE.NONE;
  }

  // Provenance is rebuilt from what the caller actually supplied. declareConstant
  // refuses a verification claim the record cannot support, so a spec cannot be
  // promoted by asserting it.
  const requestedLevel = values.verification
    || (merged.verified ? EBC_VERIFICATION.MANUFACTURER_VERIFIED : EBC_VERIFICATION.UNKNOWN);
  const provenanceFor = (which, lossValue) => declareConstant({
    key: "loss." + parsed.ratio + "." + which,
    label: parsed.ratio + " " + which + " loss",
    value: lossValue,
    units: "dB",
    source: values.reference || merged.reference || "",
    sourceDetail: values.sourceDetail || "",
    manufacturer: merged.manufacturer,
    model: merged.model,
    wavelengthNm: merged.wavelengthNm,
    verification: requestedLevel,
    dataClass: merged.verified ? EBC_DATA_CLASS.ENGINEERING_CONSTANT : EBC_DATA_CLASS.ESTIMATE,
    recordedDate: values.recordedDate || "",
    recordedBy: values.recordedBy || "",
    notes: values.notes || "",
  });
  merged.provenance = Object.freeze({
    through: provenanceFor("through", finiteOrNull(merged.nominalThroughLossDb)),
    tap: provenanceFor("tap", finiteOrNull(merged.nominalTapLossDb)),
  });
  merged.verification = merged.provenance.through.verification;
  merged.dataClass = merged.verified ? EBC_DATA_CLASS.ENGINEERING_CONSTANT : EBC_DATA_CLASS.ESTIMATE;
  // A spec is only VERIFIED when its provenance actually stands up.
  if (merged.verified && !isVerifiedLevel(merged.verification)){
    merged.verified = false;
    merged.status = PCOT_SPEC_STATUS.UNVERIFIED;
    merged.dataClass = EBC_DATA_CLASS.ESTIMATE;
  }

  return Object.freeze({ ...specs, [parsed.ratio]: Object.freeze(merged) });
}

/** Ratios the solver is permitted to consider under the current spec set. */
export function usableRatios(specs = DEFAULT_PCOT_SPECS, { lossBasis = "nominal" } = {}){
  return PCOT_RATIOS.filter((ratio) => resolveInsertionLoss(specs[ratio], { lossBasis }).ok);
}

/** Ratios that are still waiting on engineering data. */
export function unspecifiedRatios(specs = DEFAULT_PCOT_SPECS){
  return PCOT_RATIOS.filter((ratio) => !isSpecUsable(specs[ratio]));
}

/** True when every ratio in the set has been verified against a data sheet. */
export function specsAreEngineeringApproved(specs = DEFAULT_PCOT_SPECS){
  return PCOT_RATIOS.every((ratio) => specs[ratio] && specs[ratio].verified === true);
}
