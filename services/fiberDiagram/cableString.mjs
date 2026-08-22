/**
 * Fiber Engineer — TDS cable connectivity string parser.
 *
 * TDS records a cable's fiber-by-fiber assignment in the "Cable Count" field
 * as a semicolon-separated string, e.g.
 *
 *   XD:1-25;1635CA:P0002-3;XD:28-32;1635CA,P0004:S1-7;XD:40-43;1635CA,P0004,S8:T4;XD:45-48
 *
 * Grammar
 * -------
 *   string   := segment (";" segment)*
 *   segment  := "XD" ":" range              -- unassigned / express-through fibers
 *             | head ":" range              -- an assignment
 *   head     := cableId ("," pathPart)*     -- 1635CA | 1635CA,P0004 | 1635CA,P0004,S8
 *   range    := token | token "-" tail      -- P0002-3 | S1-7 | 0364-0365 | T4 | 1-25
 *   token    := prefix? digits              -- prefix is an optional letter run
 *
 * A range tail may be abbreviated: `P0002-3` means P0002..P0003, because the
 * tail is right-aligned into the head's digit width. `0364-0365` and `S1-7`
 * behave the same way.
 *
 * Fiber numbering
 * ---------------
 * Fibers are consumed consecutively from 1. XD segments carry explicit fiber
 * numbers, so they act as a checksum rather than a hint: if an XD range does
 * not begin exactly where the running counter sits, the string is rejected.
 * All 53 distinct connectivity strings in the Node 54 TDS export satisfy this
 * invariant, so a violation means the design data disagrees with itself — it is
 * reported, never quietly absorbed.
 *
 * No DOM, no I/O.
 */

export const FIBER_ASSIGNMENT_KIND = Object.freeze({
  /** Not assigned in this cable — passes through / spare. */
  XD: "XD",
  /** A circuit riding through this cable (P-prefixed or bare TDS circuit ids). */
  EXPRESS: "EXPRESS",
  /** An output leg of a splitter (S-prefixed). */
  SPLIT_LEG: "SPLIT_LEG",
  /** A terminal / drop-feeding leg (T-prefixed). */
  DROP: "DROP",
});

/** Leg prefix -> assignment kind. Read off the TDS naming, not invented. */
const LEG_PREFIX_KIND = Object.freeze({
  S: FIBER_ASSIGNMENT_KIND.SPLIT_LEG,
  T: FIBER_ASSIGNMENT_KIND.DROP,
});

export class CableStringError extends Error {
  constructor(message, details = {}){
    super(message);
    this.name = "CableStringError";
    Object.assign(this, details);
  }
}

const CABLE_ID = /^[A-Za-z0-9_]+$/;
const RANGE_TOKEN = /^([A-Za-z]*)(\d+)$/;

/**
 * Expand one range into its ordered tokens.
 * @returns {string[]}
 */
export function expandRange(range, context = {}){
  const raw = String(range || "").trim();
  if (!raw){
    throw new CableStringError("Empty fiber range.", context);
  }
  const dash = raw.indexOf("-");
  const headText = dash === -1 ? raw : raw.slice(0, dash);
  const tailText = dash === -1 ? "" : raw.slice(dash + 1);

  const head = headText.match(RANGE_TOKEN);
  if (!head){
    throw new CableStringError(
      `Malformed range token "${headText}": expected an optional letter prefix followed by digits.`,
      { ...context, token: headText },
    );
  }
  const [, prefix, digits] = head;
  const width = digits.length;
  const start = Number.parseInt(digits, 10);

  if (dash === -1) return [prefix + digits];

  if (!/^\d+$/.test(tailText)){
    throw new CableStringError(
      `Malformed range end "${tailText}" in "${raw}": the end of a range must be digits only.`,
      { ...context, range: raw },
    );
  }
  // A short tail is right-aligned into the head width: P0002-3 -> P0003.
  const endDigits = tailText.length < width
    ? digits.slice(0, width - tailText.length) + tailText
    : tailText;
  const end = Number.parseInt(endDigits, 10);

  if (end < start){
    throw new CableStringError(
      `Descending range "${raw}": ${end} is before ${start}.`,
      { ...context, range: raw, start, end },
    );
  }
  const out = [];
  for (let value = start; value <= end; value += 1){
    out.push(prefix + String(value).padStart(width, "0"));
  }
  return out;
}

function classify(head, legToken){
  if (head === "XD") return FIBER_ASSIGNMENT_KIND.XD;
  const prefix = (String(legToken).match(RANGE_TOKEN)?.[1] || "").toUpperCase();
  return LEG_PREFIX_KIND[prefix] || FIBER_ASSIGNMENT_KIND.EXPRESS;
}

/**
 * Parse a TDS connectivity string into ordered per-fiber assignments.
 *
 * @param {string} input
 * @param {object} [options]
 * @param {number} [options.expectedFiberCount] reject if the total disagrees
 * @returns {{raw: string, fiberCount: number, assignments: Array, segments: Array}}
 */
export function parseCableString(input, options = {}){
  const raw = String(input ?? "").trim();
  if (!raw){
    throw new CableStringError("Empty connectivity string.", { raw });
  }

  const segmentTexts = raw.split(";");
  const assignments = [];
  const segments = [];
  let counter = 1;

  segmentTexts.forEach((segmentText, index) => {
    const segment = segmentText.trim();
    const context = { raw, segment, segmentIndex: index };
    if (!segment){
      throw new CableStringError(
        `Empty segment at position ${index + 1}: check for a doubled or trailing ";".`,
        context,
      );
    }
    const colon = segment.indexOf(":");
    if (colon === -1){
      throw new CableStringError(
        `Segment "${segment}" is missing its ":" separator; expected <cable>:<range> or XD:<range>.`,
        context,
      );
    }
    if (segment.indexOf(":", colon + 1) !== -1){
      throw new CableStringError(
        `Segment "${segment}" has more than one ":"; path parts are separated by "," not ":".`,
        context,
      );
    }
    const head = segment.slice(0, colon).trim();
    const rangeText = segment.slice(colon + 1).trim();
    if (!head){
      throw new CableStringError(`Segment "${segment}" has no cable identifier.`, context);
    }

    const pathParts = head.split(",").map((part) => part.trim());
    if (head !== "XD"){
      for (const part of pathParts){
        if (!CABLE_ID.test(part)){
          throw new CableStringError(
            `Invalid identifier "${part}" in segment "${segment}".`,
            { ...context, identifier: part },
          );
        }
      }
    }

    const tokens = expandRange(rangeText, context);
    const firstFiber = counter;

    if (head === "XD"){
      // XD ranges are absolute fiber numbers and must agree with the counter.
      const declaredStart = Number.parseInt(rangeText.split("-")[0], 10);
      if (declaredStart !== counter){
        throw new CableStringError(
          `XD range "${rangeText}" starts at fiber ${declaredStart} but the preceding segments end at fiber ${counter - 1}, so it should start at ${counter}.`,
          { ...context, expectedStart: counter, declaredStart },
        );
      }
    }

    tokens.forEach((token) => {
      assignments.push(Object.freeze({
        fiber: counter,
        kind: classify(head, token),
        label: head === "XD" ? "XD" : `${head}:${token}`,
        cableId: head === "XD" ? null : pathParts[0],
        path: Object.freeze(head === "XD" ? [] : pathParts.slice(1)),
        leg: head === "XD" ? null : token,
      }));
      counter += 1;
    });

    segments.push(Object.freeze({
      index,
      raw: segment,
      head,
      range: rangeText,
      kind: classify(head, tokens[0]),
      firstFiber,
      lastFiber: counter - 1,
      count: tokens.length,
    }));
  });

  const fiberCount = counter - 1;
  const expected = options.expectedFiberCount;
  if (expected !== undefined && expected !== null && Number(expected) !== fiberCount){
    throw new CableStringError(
      `Connectivity string accounts for ${fiberCount} fibers but the cable is ${expected} count.`,
      { raw, fiberCount, expectedFiberCount: Number(expected) },
    );
  }

  return Object.freeze({
    raw,
    fiberCount,
    assignments: Object.freeze(assignments),
    segments: Object.freeze(segments),
  });
}

/** Index assignments by fiber number for O(1) lookup while rendering. */
export function assignmentsByFiber(parsed){
  const map = new Map();
  for (const assignment of parsed?.assignments || []){
    map.set(assignment.fiber, assignment);
  }
  return map;
}
