/**
 * Fiber Engineer — splice diagram toolkit.
 *
 * Single import surface for connectivity-string parsing, the TIA-598 colour
 * model and the SVG splice-sheet renderer. Nothing here touches the DOM, app
 * state, Supabase or the network, and nothing here reads the clock or any
 * source of randomness, so diagrams are reproducible.
 */

export {
  FIBER_ASSIGNMENT_KIND,
  CableStringError,
  parseCableString,
  expandRange,
  assignmentsByFiber,
} from "./cableString.mjs";

export {
  TIA598_COLORS,
  TIA598_SEQUENCE_LENGTH,
  DEFAULT_CABLE_BUILD,
  FiberColorError,
  fiberColor,
  describeCableBuild,
  inferTubeSize,
} from "./fiberColors.mjs";

export {
  SpliceDiagramError,
  renderSpliceDiagram,
  escapeXml,
} from "./spliceDiagram.mjs";
