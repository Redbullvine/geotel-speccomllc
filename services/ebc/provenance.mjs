/**
 * EBC — Engineer Budget Calculator
 * Provenance tags.
 *
 * Every value the EBC displays carries a provenance tag so a calculated or
 * recommended number can never be mistaken for source engineering data or for
 * a recorded field measurement. Source data is never replaced in place; the
 * engine copies inputs and returns new result objects.
 */

export const EBC_PROVENANCE = Object.freeze({
  /** Engineering/design record (production codes, design prints, imported plan). */
  DESIGN: "DESIGN",
  /** A reading a technician actually took with a meter. */
  FIELD_MEASURED: "FIELD_MEASURED",
  /** Produced by the optical budget engine from other values. */
  CALCULATED: "CALCULATED",
  /** Produced by the recommendation solver. Never written back automatically. */
  RECOMMENDED: "RECOMMENDED",
  /** A human deliberately overrode a value in the EBC. */
  USER_OVERRIDE: "USER_OVERRIDE",
});

export const EBC_PROVENANCE_LABELS = Object.freeze({
  DESIGN: "Design record",
  FIELD_MEASURED: "Field measured",
  CALCULATED: "Calculated",
  RECOMMENDED: "Recommended (not applied)",
  USER_OVERRIDE: "User override",
});

/** Wrap a value with its provenance without mutating anything upstream. */
export function tag(value, provenance, source = ""){
  return Object.freeze({ value, provenance, source: String(source || "") });
}

export function isProvenance(value){
  return Object.prototype.hasOwnProperty.call(EBC_PROVENANCE, String(value || ""));
}
