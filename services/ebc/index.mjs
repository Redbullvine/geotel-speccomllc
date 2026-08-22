/**
 * EBC — Engineer Budget Calculator.
 *
 * Single import surface for the optical math. The EBC screen, the node map,
 * location cards, the diagnostic workflow and any automated Node analysis all
 * consume this module, so there is exactly one implementation of the cascade
 * calculation in the application.
 *
 * Nothing in here touches the DOM, app state, Supabase or the network.
 */

export { EBC_PROVENANCE, EBC_PROVENANCE_LABELS, tag, isProvenance } from "./provenance.mjs";

export {
  EBC_DATA_CLASS,
  EBC_DATA_CLASS_LABELS,
  EBC_VERIFICATION,
  EBC_VERIFICATION_LABELS,
  EBC_LOSS_PROVENANCE,
  EBC_REPORTED_ALTERNATE_LOSS_TABLE,
  EBC_CANDIDATE_LIMITS,
  EBC_REQUIRED_UNKNOWN_CONSTANTS,
  EBC_HARDWARE_IDENTIFICATION,
  declareConstant,
  describeProvenance,
  isVerifiedLevel,
} from "./engineeringConstants.mjs";

export {
  TDS_PRICELIST_SOURCE,
  TDS_TAP_LOSS_DB,
  TDS_PCOT_PARTS,
  TDS_PRICELIST_ANOMALIES,
  TDS_COMMSCOPE_CORRELATION,
  TDS_1X4_IS_SELF_CONSISTENT,
  tdsTapLossDb,
  tdsPcotPart,
  tdsTapLossConstant,
  tdsSupportedPortCounts,
} from "./tdsPricelist.mjs";

export {
  TDS_FIELDS,
  parseTdsKml,
  parseSplitterPath,
  extractTdsDesign,
  tdsLegToEbcLeg,
  tdsValue,
  tdsIdNumber,
} from "./tdsKmzImport.mjs";

export {
  PCOT_RATIOS,
  PCOT_SPEC_STATUS,
  PCOT_SPEC_SOURCE,
  DEFAULT_PCOT_SPECS,
  parseRatio,
  isRatioCoherent,
  theoreticalSplitLossDb,
  listPcotSpecs,
  getPcotSpec,
  isSpecUsable,
  finiteOrNull,
  resolveInsertionLoss,
  configurePcotSpec,
  usableRatios,
  unspecifiedRatios,
  specsAreEngineeringApproved,
} from "./pcotSpecs.mjs";

export {
  EBC_SEVERITY,
  EBC_CONFIDENCE,
  PLAUSIBLE_POWER_DBM,
  validateLeg,
  deriveConfidence,
} from "./validation.mjs";

export {
  EBC_STATUS,
  EBC_NODE_TYPE,
  calculateLeg,
  classifyMargin,
  computeSpan,
  cloneLeg,
  toKilometres,
  attenuationDbPerKm,
  findNodeResult,
  downstreamNodes,
  formatTrace,
} from "./opticalBudgetEngine.mjs";

export {
  EBC_RECOMMENDATION_OUTCOME,
  DEFAULT_CONSTRAINTS,
  evaluateCandidate,
  whatIf,
  recommendPcot,
} from "./pcotRecommendationEngine.mjs";

export {
  EBC_INDICATOR_CONFIDENCE,
  DEFAULT_DIAGNOSTIC_TOLERANCES,
  compareMeasuredToPredicted,
  compareLeg,
} from "./diagnostics.mjs";

export {
  NODE54_BRANCH_KEYS,
  deriveLegPath,
  buildNode54Leg,
  buildNode54Legs,
  findNode54LegForPcot,
} from "./node54Legs.mjs";

export {
  NODE54_TDS_LEGS,
  NODE54_TDS_PART_NUMBERS,
  NODE54_TDS_SOURCE,
  findTdsPcot,
} from "./node54TdsDesign.mjs";
