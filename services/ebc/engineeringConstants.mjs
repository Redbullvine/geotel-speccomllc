/**
 * EBC — engineering constants and their provenance.
 *
 * Every number the EBC treats as an engineering fact is declared here as a
 * record that carries where it came from. A field technician must be able to
 * tap any calculated value and follow it back to a source, so a constant that
 * cannot state its origin is UNKNOWN rather than assumed.
 *
 * Nothing in this file is permitted to invent a value. Constants with no
 * authoritative source are declared with `value: null` and the calculator
 * refuses them, instead of carrying a plausible default.
 */

/**
 * What KIND of data a number is. These are never silently mixed: a result
 * built from an ESTIMATE is reported as preliminary even when every other
 * input is design data.
 */
export const EBC_DATA_CLASS = Object.freeze({
  /** Comes from the TDS design of record (KMZ export, production codes). */
  DESIGN_DATA: "DESIGN_DATA",
  /** A reading somebody actually took with a meter in the field. */
  FIELD_DATA: "FIELD_DATA",
  /** A verified manufacturer or TDS specification. */
  ENGINEERING_CONSTANT: "ENGINEERING_CONSTANT",
  /** A stand-in used because no authoritative specification is available. */
  ESTIMATE: "ESTIMATE",
});

export const EBC_DATA_CLASS_LABELS = Object.freeze({
  DESIGN_DATA: "Design data (TDS)",
  FIELD_DATA: "Field measured",
  ENGINEERING_CONSTANT: "Verified engineering constant",
  ESTIMATE: "Estimate — not verified",
});

/**
 * How well a value is evidenced. Only the first two count as verified; the
 * distinction between them is who stands behind the number.
 */
export const EBC_VERIFICATION = Object.freeze({
  /** Transcribed from a manufacturer data sheet for a named part. */
  MANUFACTURER_VERIFIED: "MANUFACTURER_VERIFIED",
  /** Stated by TDS engineering for this plant. */
  TDS_VERIFIED: "TDS_VERIFIED",
  /** A published industry norm, correct in general but not for this part. */
  INDUSTRY_REFERENCE: "INDUSTRY_REFERENCE",
  /** A figure someone entered into this repository without a citation. */
  REPO_ESTIMATE: "REPO_ESTIMATE",
  /** Origin could not be established. */
  UNKNOWN: "UNKNOWN",
});

export const EBC_VERIFICATION_LABELS = Object.freeze({
  MANUFACTURER_VERIFIED: "Manufacturer verified",
  TDS_VERIFIED: "TDS verified",
  INDUSTRY_REFERENCE: "Industry reference",
  REPO_ESTIMATE: "Repository estimate",
  UNKNOWN: "Unknown origin",
});

/** Only these two levels may be presented as engineering approved. */
const VERIFIED_LEVELS = new Set([
  EBC_VERIFICATION.MANUFACTURER_VERIFIED,
  EBC_VERIFICATION.TDS_VERIFIED,
]);

export function isVerifiedLevel(verification){
  return VERIFIED_LEVELS.has(verification);
}

/**
 * Declare an engineering constant with its full provenance.
 *
 * A record is only `verified` when its verification level is manufacturer or
 * TDS AND it actually carries a value, a source and a part identity. That rule
 * is enforced here rather than trusted to the caller, so no code path can
 * promote a number by simply passing `verified: true`.
 */
export function declareConstant({
  key = "",
  label = "",
  value = null,
  units = "",
  source = "",
  sourceDetail = "",
  manufacturer = "",
  model = "",
  wavelengthNm = null,
  verification = EBC_VERIFICATION.UNKNOWN,
  dataClass = EBC_DATA_CLASS.ESTIMATE,
  recordedDate = "",
  recordedBy = "",
  notes = "",
} = {}){
  const hasValue = value !== null && value !== undefined && value !== "";
  const identified = String(manufacturer || "").trim() !== "" || String(model || "").trim() !== "";
  const cited = String(source || "").trim() !== "";
  const verified = hasValue && cited && identified && isVerifiedLevel(verification);

  return Object.freeze({
    key: String(key),
    label: String(label),
    value: hasValue ? value : null,
    units: String(units),
    source: String(source),
    sourceDetail: String(sourceDetail),
    manufacturer: String(manufacturer),
    model: String(model),
    wavelengthNm: wavelengthNm === null || wavelengthNm === undefined ? null : Number(wavelengthNm),
    // If a caller claims manufacturer/TDS verification but the record cannot
    // support it, the claim is downgraded rather than accepted.
    verification: verified ? verification : (isVerifiedLevel(verification) ? EBC_VERIFICATION.UNKNOWN : verification),
    dataClass: verified ? EBC_DATA_CLASS.ENGINEERING_CONSTANT : dataClass,
    verified,
    available: hasValue,
    recordedDate: String(recordedDate),
    recordedBy: String(recordedBy),
    notes: String(notes),
  });
}

/** One-line human explanation of where a number came from. */
export function describeProvenance(constant){
  if (!constant) return "No provenance recorded.";
  if (!constant.available) return "No value is configured. " + (constant.notes || "");
  const parts = [];
  parts.push(EBC_VERIFICATION_LABELS[constant.verification] || constant.verification);
  if (constant.manufacturer || constant.model){
    parts.push([constant.manufacturer, constant.model].filter(Boolean).join(" "));
  }
  if (constant.wavelengthNm) parts.push(constant.wavelengthNm + " nm");
  if (constant.source) parts.push(constant.source);
  if (constant.recordedDate) parts.push(constant.recordedDate);
  return parts.join(" · ");
}

/* ------------------------------------------------------------------------ *
 * The provenance ledger for the loss figures the EBC currently uses.
 *
 * AUDIT RESULT, recorded so it does not have to be re-derived:
 *
 * The five PCOT loss pairs entered this repository in a single commit,
 * a6f0c6f "Add Node 54 ROOT diagnostics workflow" (Danny Camp,
 * 2026-08-18), inside services/node54Diagnostics.mjs. There is no earlier
 * revision, no imported document, no manufacturer name and no citation
 * anywhere in the repository or in either TDS KMZ export. The commit that
 * introduced them already described them as "engineering/production-code
 * design references, not manufacturer data sheets".
 *
 * Numerically they sit at the ideal split loss for each ratio plus roughly
 * 0.25-0.5 dB of excess loss, which is the shape of a generic optical-tap
 * rule of thumb rather than a measured device. That is consistent with an
 * uncited estimate and is NOT evidence of a specific product.
 *
 * Classification: REPO_ESTIMATE. Not promotable without a data sheet.
 * ------------------------------------------------------------------------ */

const REPO_ESTIMATE_COMMIT = "a6f0c6f Add Node 54 ROOT diagnostics workflow";

function repoEstimateLoss(key, label, value){
  return declareConstant({
    key,
    label,
    value,
    units: "dB",
    source: "services/node54Diagnostics.mjs (NODE54_TAP_RATIO_ESTIMATES)",
    sourceDetail: "Introduced by commit " + REPO_ESTIMATE_COMMIT + ". No citation, manufacturer or data sheet accompanies it.",
    manufacturer: "",
    model: "",
    wavelengthNm: 1550,
    verification: EBC_VERIFICATION.REPO_ESTIMATE,
    dataClass: EBC_DATA_CLASS.ESTIMATE,
    recordedDate: "2026-08-18",
    recordedBy: "Danny Camp",
    notes: "Approximates ideal split loss plus roughly 0.25-0.5 dB excess. Treat as a placeholder until the manufacturer data sheet for the TDS part number is obtained.",
  });
}

export const EBC_LOSS_PROVENANCE = Object.freeze({
  "90/10": Object.freeze({ through: repoEstimateLoss("loss.90/10.through", "90/10 through loss", 0.7), tap: repoEstimateLoss("loss.90/10.tap", "90/10 tap loss", 10.5) }),
  "85/15": Object.freeze({ through: repoEstimateLoss("loss.85/15.through", "85/15 through loss", 1.0), tap: repoEstimateLoss("loss.85/15.tap", "85/15 tap loss", 8.5) }),
  "80/20": Object.freeze({ through: repoEstimateLoss("loss.80/20.through", "80/20 through loss", 1.4), tap: repoEstimateLoss("loss.80/20.tap", "80/20 tap loss", 7.5) }),
  "70/30": Object.freeze({ through: repoEstimateLoss("loss.70/30.through", "70/30 through loss", 2.0), tap: repoEstimateLoss("loss.70/30.tap", "70/30 tap loss", 5.5) }),
  "60/40": Object.freeze({ through: repoEstimateLoss("loss.60/40.through", "60/40 through loss", 2.6), tap: repoEstimateLoss("loss.60/40.tap", "60/40 tap loss", 4.5) }),
});

/**
 * A second loss table was reported verbally as being "the existing values".
 * It does NOT match what is in this repository and could not be located in the
 * repository, in either TDS KMZ export, in the Ruidoso production codes or in
 * git history. It is recorded here so the discrepancy is preserved rather than
 * quietly resolved in either direction. It is NOT used by the calculator.
 */
export const EBC_REPORTED_ALTERNATE_LOSS_TABLE = Object.freeze({
  status: "UNLOCATED",
  reportedOn: "2026-08-21",
  reportedBy: "user",
  searchedIn: Object.freeze([
    "SpecCom repository working tree",
    "git history (all branches, -S content search)",
    "Project.kmz TDS export",
    "1635CA_PON_Field_Navigation.kmz",
    "RUIDOSO production code CSV and production PDFs",
  ]),
  values: Object.freeze({
    "90/10": Object.freeze({ throughLossDb: 0.8, tapLossDb: 11.2 }),
    "85/15": Object.freeze({ throughLossDb: 1.0, tapLossDb: 9.2 }),
    "80/20": Object.freeze({ throughLossDb: 1.3, tapLossDb: 7.8 }),
    "70/30": Object.freeze({ throughLossDb: 2.0, tapLossDb: 6.0 }),
    "60/40": Object.freeze({ throughLossDb: 2.7, tapLossDb: 4.7 }),
  }),
  inRepositoryValues: Object.freeze({
    "90/10": Object.freeze({ throughLossDb: 0.7, tapLossDb: 10.5 }),
    "85/15": Object.freeze({ throughLossDb: 1.0, tapLossDb: 8.5 }),
    "80/20": Object.freeze({ throughLossDb: 1.4, tapLossDb: 7.5 }),
    "70/30": Object.freeze({ throughLossDb: 2.0, tapLossDb: 5.5 }),
    "60/40": Object.freeze({ throughLossDb: 2.6, tapLossDb: 4.5 }),
  }),
  verification: EBC_VERIFICATION.UNKNOWN,
  note: "Both tables are unverified. Neither is used as engineering data. Resolve by obtaining the manufacturer data sheet, not by choosing between them.",
});

/**
 * Candidate engineering limits found in project material but NOT yet
 * attributable to TDS engineering. Offered to the user to confirm or reject;
 * never applied automatically.
 */
export const EBC_CANDIDATE_LIMITS = Object.freeze([
  declareConstant({
    key: "limits.failThresholdDbm.fieldNavKmz",
    label: "Receive power FAIL threshold",
    value: -24,
    units: "dBm",
    source: "1635CA_PON_Field_Navigation.kmz",
    sourceDetail: 'Every one of the 89 analysis placemarks carries Data name="FailThreshold_dBm" with the value -24.00, and the legend band reads "-24.00 dBm and lower". The overlay also carries Status (FAIL/PASS/FIELD DISCREPANCY/NO TEST/MIXED), Priority, Area and WeakestReading_dBm fields, none of which appear in the TDS Project.kmz design export and none of which this repository generates.',
    verification: EBC_VERIFICATION.UNKNOWN,
    dataClass: EBC_DATA_CLASS.ESTIMATE,
    notes: "Authorship of that overlay is unconfirmed, so it is not known whether -24 dBm is a TDS acceptance limit or a threshold chosen by whoever built the file. Confirm with TDS before using it as a receiver minimum. Note the repository's own NODE54_THRESHOLDS.weakAbsoluteDbm is -28 dBm, a different number from a different unproven source.",
  }),
  declareConstant({
    key: "limits.weakAbsoluteDbm.repo",
    label: "Weak-signal threshold used by Node 54 diagnostics",
    value: -28,
    units: "dBm",
    source: "services/node54Diagnostics.mjs (NODE54_THRESHOLDS)",
    sourceDetail: "Introduced by commit " + REPO_ESTIMATE_COMMIT + " alongside the loss estimates. No citation.",
    verification: EBC_VERIFICATION.REPO_ESTIMATE,
    dataClass: EBC_DATA_CLASS.ESTIMATE,
    recordedDate: "2026-08-18",
    notes: "Used as guidance in the existing Node 54 workflow. Not adopted by the EBC as a receiver minimum.",
  }),
]);

/**
 * Constants the EBC needs and does not have. Declared explicitly with a null
 * value so the UI can list precisely what to go and get, rather than the
 * calculator silently defaulting them.
 */
export const EBC_REQUIRED_UNKNOWN_CONSTANTS = Object.freeze([
  declareConstant({ key: "launch.powerDbm", label: "OLT / node launch power", units: "dBm", notes: "Not stored in any project source. Measure at the head of the leg or obtain from TDS." }),
  declareConstant({ key: "limits.receiverMinDbm", label: "Minimum required receive power", units: "dBm", notes: "No TDS acceptance limit located. See EBC_CANDIDATE_LIMITS for an unconfirmed candidate." }),
  declareConstant({ key: "limits.receiverMaxDbm", label: "Receiver overload threshold", units: "dBm", notes: "Not located in any project source." }),
  declareConstant({ key: "limits.engineeringReserveDb", label: "Engineering reserve", units: "dB", notes: "Not located in any project source. TDS design practice required." }),
  declareConstant({ key: "fiber.attenuationDbPerKm", label: "Fiber attenuation coefficient", units: "dB/km", notes: "Neither TDS KMZ records a coefficient or a fiber type." }),
  declareConstant({ key: "defaults.spliceLossDb", label: "Loss per splice", units: "dB", notes: "No splice counts or per-splice budget in any project source." }),
  declareConstant({ key: "defaults.connectorLossDb", label: "Loss per connector", units: "dB", notes: "No connector counts or per-connector budget in any project source." }),
  declareConstant({ key: "pcot.insertionLoss", label: "PCOT insertion loss (per ratio, through and tap)", units: "dB", notes: "Absent from both TDS KMZ exports. Requires the manufacturer data sheet for the HxFO(1x4)PCOT(xx/yy)MO parts." }),
]);

/* ------------------------------------------------------------------------ *
 * Hardware identification audit.
 * ------------------------------------------------------------------------ */

/**
 * Result of searching for a manufacturer behind the TDS catalogue code.
 *
 * Searched for: HxFO, HxFO(1x4)PCOT, PCOT, 1x4, the five ratios, CommScope,
 * OCC1P, OCC1P-TAP-4P-19-S2S2SEB, TAP-4P, S2S2SEB, optical tap, insertion
 * loss, tap loss, through loss, excess loss, splitter loss, dB, manufacturer,
 * model, part number, data sheet, plus eleven other optical vendors.
 *
 * Scope: the SpecCom working tree, all git history, the TDS Project.kmz design
 * export, the 1635CA_PON_Field_Navigation.kmz overlay, the RUIDOSO production
 * code CSV, full text extracted from all ten RUIDOSO production and photo PDFs
 * (23,738 characters, including compressed streams a byte-grep cannot reach),
 * and the TDS material pricelist.
 *
 * OUTCOME: the manufacturer WAS found, but only in the TDS pricelist. It does
 * not appear in the repository, in either KMZ, or in any production document.
 */
export const EBC_HARDWARE_IDENTIFICATION = Object.freeze({
  tdsCatalogueCodes: Object.freeze([
    "HxFO(1x4)PCOT(90/10)MO", "HxFO(1x4)PCOT(85/15)MO", "HxFO(1x4)PCOT(80/20)MO",
    "HxFO(1x4)PCOT(70/30)MO", "HxFO(1x4)PCOT(60/40)MO", "HxFO(1x4)PCOT(00/00)MO",
    "HxFO(1x2)PCOT(90/10)MO", "HxFO(1x2)PCOT(85/15)MO", "HxFO(1x2)PCOT(80/20)MO",
    "HxFO(1x2)PCOT(70/30)MO", "HxFO(1x2)PCOT(60/40)MO", "HxFO(1x2)PCOT(00/00)MO",
    "HAFO(PCOT)LO",
  ]),
  manufacturer: "CommScope",
  manufacturerVerification: EBC_VERIFICATION.TDS_VERIFIED,
  manufacturerSource: "TDS Pricelist- Effective 10.1.23.xlsx, Vendor column on all 56 PCOT rows.",
  alternateManufacturer: "Corning (MDT series), listed in the pricelist under Preferred Materials / Vendor part number(s).",
  enclosure: "OFDC-B8G, SC/APC input, SC/APC through, SC/APC drops.",
  /**
   * The prefix letter is placement, not device. HAFO and HBFO rows for the same
   * (1xN)(ratio) carry an identical vendor, enclosure, work-unit definition and
   * tap figure, so HxFO resolves to the same optical specification either way.
   */
  prefixResolution: Object.freeze({
    observed: "HAFO and HBFO both present in the pricelist; literal HxFO never appears there.",
    conclusion: "The A/B letter tracks placement (the same split appears on plain cable units such as HAFO(24)/HBFO(24)), not the optical device. Every matching (1xN)(ratio) pair is optically identical, so the tap figure is the same whichever way x resolves.",
    verification: EBC_VERIFICATION.TDS_VERIFIED,
  }),
  /**
   * The reported CommScope part re-assessed against the pricelist. The tap
   * value, port count and vendor all agree; the enclosure family does not.
   */
  reportedFieldHardware: Object.freeze({
    partNumber: "CommScope OCC1P-TAP-4P-19-S2S2SEB",
    occurrencesInRepository: 0,
    occurrencesInTdsProjectKmz: 0,
    occurrencesInFieldNavigationKmz: 0,
    occurrencesInProductionCodes: 0,
    occurrencesInProductionPdfText: 0,
    occurrencesInTdsPricelist: 0,
    linkedToTdsCatalogueCode: "PARTIAL",
    agreesOn: Object.freeze(["vendor CommScope", "4 ports", "19 dB tap", "an S2 segment in the part number"]),
    differsOn: Object.freeze(["enclosure family: OCC1P versus the pricelist's OFDC-BG8"]),
    verification: EBC_VERIFICATION.UNKNOWN,
    note: "The exact string appears in no searched source. However the TDS 1x4 90/10 device is a CommScope 4-drop, 19 dB tap (OFDC-BG8-S2/6C-4T19), and OCC1P-TAP-4P-19 decodes to a 4-port 19 dB tap from the same vendor. That is strong corroboration of the same TAP SPECIFICATION, and is not proof of the same ordering part: the enclosure families differ. A photograph of an installed label is still what would settle which enclosure is in the ground.",
  }),
  note: "HxFO(1x4)PCOT(xx/yy)MO is a TDS material unit description. The TDS pricelist maps it to CommScope hardware with a stated tap loss; it states no through loss, no worst-case insertion loss and no wavelength.",
});
