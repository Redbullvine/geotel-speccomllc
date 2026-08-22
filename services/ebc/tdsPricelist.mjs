/**
 * EBC — TDS material pricelist extract (the TDS engineering table).
 *
 * SOURCE: "TDS Pricelist- Effective 10.1.23.xlsx", sheet "Pricelist 10.1.23",
 * 759 rows, 56 of them PCOT rows. Columns used: TDS Unit, Millennium Part #,
 * Vendor Code, Vendor, Millennium Desc., Notes, Preferred Materials / Vendor
 * part number(s), TDS Work Unit Definitions.
 *
 * This is the first authoritative optical figure found for these devices. The
 * TAP loss is stated by TDS in the Millennium description, e.g.
 *   HBFO(1x4)PCOT(90/10) -> "OFDC-B8G, SC/APC, 4 Drop Tap 19dB, 4 Drop
 *                            Adapters, SC/APC In-put, SC/APC Thru-put"
 *
 * WHY THE HxFO / HAFO / HBFO PREFIX DOES NOT MATTER FOR OPTICS
 * -----------------------------------------------------------
 * Node 54 records use HxFO. The pricelist contains HAFO and HBFO, never a
 * literal HxFO for a PCOT. For EVERY matching (1xN)(ratio) pair, the HAFO row
 * and the HBFO row carry an identical vendor, identical enclosure, identical
 * work-unit definition and an identical Tap dB figure; the letter tracks
 * placement (the same A/B split appears on plain cable units such as HAFO(24)
 * and HBFO(24)), not the optical device. So whatever "x" resolves to, the tap
 * specification is the same number. That is why the value below can be relied
 * on without first resolving the prefix.
 *
 * WHAT THIS SOURCE DOES NOT STATE
 * -------------------------------
 *   - THROUGH loss: no through-path figure appears anywhere in the pricelist.
 *   - Maximum/worst-case insertion loss: not stated, only the nominal tap.
 *   - Wavelength for the stated tap loss: not stated.
 * Those remain UNKNOWN and the EBC continues to treat any budget that depends
 * on them as preliminary.
 */

import { EBC_DATA_CLASS, EBC_VERIFICATION, declareConstant } from "./engineeringConstants.mjs";

export const TDS_PRICELIST_SOURCE = Object.freeze({
  file: "TDS Pricelist- Effective 10.1.23.xlsx",
  sheet: "Pricelist 10.1.23",
  effectiveDate: "2023-10-01",
  rows: 759,
  pcotRows: 56,
  vendor: "CommScope",
  alternateVendor: "Corning (listed under Preferred Materials)",
  enclosure: "OFDC-B8G",
  connectors: "SC/APC input, SC/APC through, SC/APC drops",
  statesTapLoss: true,
  statesThroughLoss: false,
  statesMaxInsertionLoss: false,
  statesWavelength: false,
});

/**
 * TDS tap loss by splitter size and ratio, in dB, as stated by TDS.
 * The tap figure is the loss from the input to EACH drop port, which is why it
 * grows with the number of drops for the same ratio.
 */
export const TDS_TAP_LOSS_DB = Object.freeze({
  2: Object.freeze({ "97/03": 21, "95/05": 19, "93/07": 17, "90/10": 15, "85/15": 14, "80/20": 12, "70/30": 10, "60/40": 8, "45/55": 7, "30/70": 5, "00/00": 4 }),
  4: Object.freeze({ "90/10": 19, "85/15": 17, "80/20": 15, "70/30": 13, "60/40": 11, "45/55": 10, "30/70": 9, "00/00": 7 }),
  8: Object.freeze({ "90/10": 22, "85/15": 21, "80/20": 19, "70/30": 17, "60/40": 15 }),
});

/** CommScope and Millennium identifiers for the 1x4 devices Node 54 uses. */
export const TDS_PCOT_PARTS = Object.freeze({
  4: Object.freeze({
    "90/10": Object.freeze({ vendor: "CommScope", vendorCode: "760253317", vendorPart: "OFDC-BG8-S2/6C-4T19", millenniumPart: "150-100543-COM", alternate: "Corning MDT-0417NS000MW-P 4 Port GRN Band" }),
    "85/15": Object.freeze({ vendor: "CommScope", vendorCode: "760253316", vendorPart: "OFDC-BG8-S2/6C-4T17", millenniumPart: "150-100542-COM", alternate: "Corning MDT-0416NS000MW-P 4 Port YLW Band" }),
    "80/20": Object.freeze({ vendor: "CommScope", vendorCode: "760253315", vendorPart: "OFDC-BG8-S2/6C-4T15", millenniumPart: "150-100592-COM", alternate: "Corning MDT-0415NS000MW-P 80/20 4 Port" }),
    "70/30": Object.freeze({ vendor: "CommScope", vendorCode: "760253314", vendorPart: "OFDC-BG8-S2/6C-4T13", millenniumPart: "150-100541-COM", alternate: "Corning MDT-0412NS000MW-P 4 Port BLU Band" }),
    "60/40": Object.freeze({ vendor: "CommScope", vendorCode: "760253313", vendorPart: "OFDC-BG8-S2/6C-4T11", millenniumPart: "150-100079-COM", alternate: "Corning MDT-0411NS000MW-P 60/40 4 Port" }),
    "45/55": Object.freeze({ vendor: "CommScope", vendorCode: "760253312", vendorPart: "OFDC-BG8-S2/6C-4T10", millenniumPart: "150-100583-COM", alternate: "Corning MDT series - Not available" }),
    "30/70": Object.freeze({ vendor: "CommScope", vendorCode: "760253311", vendorPart: "OFDC-BG8-S2/6C-4T09", millenniumPart: "150-100584-COM", alternate: "Corning MDT series - Not available" }),
    "00/00": Object.freeze({ vendor: "CommScope", vendorCode: "760253310", vendorPart: "OFDC-BG8-S2/6C-4T07", millenniumPart: "TBD", alternate: "Corning MDT-0406NS000MW-P 00/00 4 Port" }),
  }),
});

/**
 * Internal inconsistencies observed in the source sheet, recorded rather than
 * silently cleaned. The 1x4 family — the one Node 54 uses — is self-consistent
 * throughout: every Tap dB in the description matches the 4Tnn suffix of the
 * CommScope part number. Some 1x2 rows do not agree with themselves.
 */
export const TDS_PRICELIST_ANOMALIES = Object.freeze([
  Object.freeze({ unit: "HBFO(1x2)PCOT(95/05)", descriptionTapDb: 19, vendorPartSuffix: "2T17", note: "Description and CommScope part suffix disagree." }),
  Object.freeze({ unit: "HBFO(1x2)PCOT(93/07)", descriptionTapDb: 17, vendorPartSuffix: "2T19", note: "Description and CommScope part suffix disagree; looks transposed with the 95/05 row." }),
  Object.freeze({ unit: "HBFO(1x2)PCOT(70/30)", descriptionTapDb: 10, vendorPartSuffix: "2T11", note: "Description and CommScope part suffix disagree by 1 dB." }),
]);

export const TDS_1X4_IS_SELF_CONSISTENT = true;

/** Splitter sizes for which TDS states a tap loss. */
export function tdsSupportedPortCounts(){
  return Object.keys(TDS_TAP_LOSS_DB).map(Number).sort((a, b) => a - b);
}

/** TDS tap loss in dB for a splitter size and ratio, or null when unstated. */
export function tdsTapLossDb(portCount, ratio){
  const table = TDS_TAP_LOSS_DB[Number(portCount)];
  if (!table) return null;
  const value = table[String(ratio || "").trim()];
  return value === undefined ? null : value;
}

export function tdsPcotPart(portCount, ratio){
  const table = TDS_PCOT_PARTS[Number(portCount)];
  if (!table) return null;
  return table[String(ratio || "").trim()] || null;
}

/**
 * The tap loss as a provenance-carrying engineering constant.
 * Returns null when TDS does not state a figure for that combination.
 */
export function tdsTapLossConstant(portCount, ratio){
  const value = tdsTapLossDb(portCount, ratio);
  if (value === null) return null;
  const part = tdsPcotPart(portCount, ratio);
  return declareConstant({
    key: "loss." + ratio + ".tap.1x" + portCount,
    label: ratio + " tap loss (1x" + portCount + ", to each drop port)",
    value,
    units: "dB",
    source: TDS_PRICELIST_SOURCE.file + ", sheet " + TDS_PRICELIST_SOURCE.sheet,
    sourceDetail: "TDS Unit HxFO(1x" + portCount + ")PCOT(" + ratio + "); Millennium description states \"" + portCount + " Drop Tap " + value + "dB\"."
      + (part ? " CommScope " + part.vendorCode + " " + part.vendorPart + "; Millennium " + part.millenniumPart + "." : "")
      + " HAFO and HBFO rows for this device are identical, so the placement letter does not affect the optical figure.",
    manufacturer: part ? part.vendor : "CommScope",
    model: part ? part.vendorPart : "",
    // TDS does not state the wavelength this figure applies at.
    wavelengthNm: null,
    verification: EBC_VERIFICATION.TDS_VERIFIED,
    dataClass: EBC_DATA_CLASS.ENGINEERING_CONSTANT,
    recordedDate: TDS_PRICELIST_SOURCE.effectiveDate,
    recordedBy: "TDS pricelist",
    notes: "TDS states the tap figure only. Through loss, worst-case insertion loss and the reference wavelength are not stated in this source.",
  });
}

/**
 * The reported field hardware, re-assessed against the pricelist.
 *
 * "CommScope OCC1P-TAP-4P-19-S2S2SEB" decomposes as TAP, 4 Port, 19 dB. The
 * TDS 1x4 90/10 device is "4 Drop Tap 19dB" from CommScope, part
 * OFDC-BG8-S2/6C-4T19. The tap value, the port count and the vendor all agree,
 * and both part numbers carry an S2 segment.
 *
 * What still differs is the enclosure family: OCC1P versus OFDC-BG8. So the
 * evidence supports "same tap specification, possibly a different enclosure
 * variant". It does NOT establish that they are the same ordering part, and a
 * photograph of an installed label is still what would settle it.
 */
export const TDS_COMMSCOPE_CORRELATION = Object.freeze({
  reportedPart: "CommScope OCC1P-TAP-4P-19-S2S2SEB",
  tdsPart: "OFDC-BG8-S2/6C-4T19",
  tdsUnit: "HxFO(1x4)PCOT(90/10)MO",
  agreesOn: Object.freeze(["vendor (CommScope)", "port count (4)", "tap loss (19 dB)", "an S2 segment in the part number"]),
  differsOn: Object.freeze(["enclosure family: OCC1P versus OFDC-BG8"]),
  conclusion: "SAME TAP SPECIFICATION, ENCLOSURE VARIANT UNCONFIRMED",
  verification: EBC_VERIFICATION.TDS_VERIFIED,
  stillNeeded: "A photograph of an installed device label to confirm which enclosure is actually in the ground.",
});
