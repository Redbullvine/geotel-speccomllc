/**
 * Fiber Engineer — splice diagram renderer.
 *
 * Produces a standalone SVG splice sheet for one pole/enclosure from its
 * connectivity strings. Pure: no DOM, no app state, no I/O, no clock and no
 * randomness, so the same pole always renders a byte-identical SVG.
 *
 * Layout
 * ------
 *   left strip   cable IN   : fiber no. | tube chip | fiber colour chip | label
 *   centre       routing    : red express runs, splitter boxes with fan-outs,
 *                             dashed arrows to secondary OUT cables, drop boxes
 *   right strip  cable OUT  : label | fiber colour chip | tube chip | fiber no.
 *
 * Optical annotation is gated: power values are only drawn when the caller
 * passes annotations AND those annotations are verified, or when it explicitly
 * opts in to unverified values — in which case every value is labelled
 * UNVERIFIED. A dBm figure derived from an unverified PCOT specification can
 * never appear unlabelled.
 */

import { parseCableString } from "./cableString.mjs";
import { describeCableBuild, fiberColor, inferTubeSize } from "./fiberColors.mjs";

export class SpliceDiagramError extends Error {
  constructor(message, details = {}){
    super(message);
    this.name = "SpliceDiagramError";
    Object.assign(this, details);
  }
}

const LAYOUT = Object.freeze({
  width: 1040,
  rowHeight: 17,
  headerHeight: 92,
  footerHeight: 96,
  leftStripX: 18,
  stripWidth: 268,
  routeLeft: 300,
  routeRight: 738,
  rightStripX: 754,
  splitterWidth: 92,
  splitterGap: 132,
});

const PALETTE = Object.freeze({
  paper: "#FFFFFF",
  ink: "#101828",
  muted: "#667085",
  rule: "#D0D5DD",
  strip: "#F9FAFB",
  route: "#D92D20",
  splitter: "#FEF3F2",
  splitterEdge: "#D92D20",
  pass: "#067647",
  marginal: "#B54708",
  fail: "#D92D20",
  unverified: "#B54708",
});

const STATUS_COLOR = Object.freeze({
  PASS: PALETTE.pass,
  MARGINAL: PALETTE.marginal,
  FAIL: PALETTE.fail,
  UNKNOWN: PALETTE.muted,
});

/** XML-escape text destined for an SVG text node or attribute. */
export function escapeXml(value){
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Fixed-precision coordinate so output cannot drift between platforms. */
const n = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return "0";
  return String(Number(number.toFixed(2)));
};

const dbm = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return `${number >= 0 ? "" : ""}${number.toFixed(2)} dBm`;
};

function resolveBuild(cable, parsed){
  const fiberCount = Number(cable?.fiberCount) || parsed.fiberCount;
  const tubeSize = Number(cable?.tubeSize) || inferTubeSize(fiberCount) || fiberCount;
  return { fiberCount, tubeSize };
}

function parseCable(cable, role){
  if (!cable) return null;
  const text = String(cable.string ?? cable.cableCount ?? "").trim();
  if (!text){
    throw new SpliceDiagramError(`${role} cable has no connectivity string.`, { role, cable });
  }
  let parsed;
  try {
    parsed = parseCableString(text, { expectedFiberCount: cable.fiberCount ?? undefined });
  } catch (error){
    throw new SpliceDiagramError(
      `${role} cable "${cable.id || "(unnamed)"}" could not be parsed: ${error.message}`,
      { role, cable, cause: error },
    );
  }
  return { ...cable, parsed, build: resolveBuild(cable, parsed) };
}

function rowY(fiber, top, rowHeight){
  return top + (fiber - 1) * rowHeight + rowHeight / 2;
}

function chip(x, y, w, h, fill, stroke){
  return `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="2" fill="${fill}" stroke="${stroke}" stroke-width="0.6"/>`;
}

function text(x, y, value, { size = 9, fill = PALETTE.ink, anchor = "start", weight = "400", family = "monospace" } = {}){
  return `<text x="${n(x)}" y="${n(y)}" font-family="${family}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}">${escapeXml(value)}</text>`;
}

/** One side strip: a row per fiber with tube colour, strand colour and label. */
function renderStrip(cable, { x, top, rowHeight, mirrored, title }){
  if (!cable) return "";
  const parts = [];
  const w = LAYOUT.stripWidth;
  const rows = cable.parsed.fiberCount;

  parts.push(`<rect x="${n(x)}" y="${n(top - 22)}" width="${n(w)}" height="${n(rows * rowHeight + 22)}" rx="4" fill="${PALETTE.strip}" stroke="${PALETTE.rule}" stroke-width="0.8"/>`);
  parts.push(text(mirrored ? x + w - 8 : x + 8, top - 8, title, { size: 10, weight: "700", fill: PALETTE.ink, anchor: mirrored ? "end" : "start", family: "sans-serif" }));

  const byFiber = new Map(cable.parsed.assignments.map((a) => [a.fiber, a]));

  for (let fiber = 1; fiber <= rows; fiber += 1){
    const y = rowY(fiber, top, rowHeight);
    const colour = fiberColor(fiber, cable.build);
    const assignment = byFiber.get(fiber);
    const label = assignment ? assignment.label : "XD";

    // column offsets, mirrored for the right-hand strip
    const numX = mirrored ? x + w - 10 : x + 10;
    const tubeX = mirrored ? x + w - 46 : x + 26;
    const fibX = mirrored ? x + w - 76 : x + 56;
    const labX = mirrored ? x + w - 92 : x + 88;

    parts.push(text(numX, y + 3, String(fiber), { size: 8.5, fill: PALETTE.muted, anchor: mirrored ? "end" : "start" }));
    parts.push(chip(tubeX - (mirrored ? 20 : 0), y - 5, 20, 10, colour.tubeColor.hex, PALETTE.rule));
    parts.push(chip(fibX - (mirrored ? 22 : 0), y - 5, 22, 10, colour.color.hex, PALETTE.rule));
    parts.push(text(labX, y + 3, label, {
      size: 8.5,
      fill: label === "XD" ? PALETTE.muted : PALETTE.ink,
      anchor: mirrored ? "end" : "start",
      weight: label === "XD" ? "400" : "600",
    }));
  }
  return parts.join("\n");
}

/** Locate a label on either strip so routing knows which row to draw to. */
function locate(label, inCable, outCables, geometry){
  const { top, rowHeight } = geometry;
  if (inCable){
    const hit = inCable.parsed.assignments.find((a) => a.label === label);
    if (hit) return { side: "in", fiber: hit.fiber, x: LAYOUT.leftStripX + LAYOUT.stripWidth, y: rowY(hit.fiber, top, rowHeight) };
  }
  for (let index = 0; index < outCables.length; index += 1){
    const cable = outCables[index];
    const hit = cable.parsed.assignments.find((a) => a.label === label);
    if (hit){
      return {
        side: "out",
        cableIndex: index,
        primary: Boolean(cable.primary),
        fiber: hit.fiber,
        x: LAYOUT.rightStripX,
        y: cable.primary ? rowY(hit.fiber, top, rowHeight) : null,
      };
    }
  }
  return null;
}

function renderSplitters(pole, inCable, outCables, geometry, annotation){
  const { top, rowHeight } = geometry;
  const splitters = Array.isArray(pole.splitters) ? pole.splitters : [];
  const parts = [];

  splitters.forEach((splitter, index) => {
    const outputs = Array.isArray(splitter.outputs) ? splitter.outputs : [];
    const inputLabel = String(splitter.inputLabel || "");
    const boxX = LAYOUT.routeLeft + 26 + index * LAYOUT.splitterGap;

    const targets = outputs.map((leg) => ({
      leg,
      label: `${inputLabel}:${leg}`,
      at: locate(`${inputLabel}:${leg}`, inCable, outCables, geometry),
    }));
    const placed = targets.filter((t) => t.at && t.at.y !== null);

    // The feed lands under the label form that ends in ":", while outputs are
    // built from the "," path prefix: "1635CA,P0004" feeds from "1635CA:P0004",
    // and "1635CA,P0004,S8" feeds from "1635CA,P0004:S8". Callers may state the
    // feed explicitly with sourceLabel; otherwise it is derived by swapping the
    // last separator, which is exact rather than a guess.
    const sourceLabel = String(splitter.sourceLabel || "")
      || inputLabel.replace(/,([^,]*)$/, ":$1");
    const source = locate(sourceLabel, inCable, outCables, geometry);

    const ys = placed.map((t) => t.at.y).concat(source ? [source.y] : []);
    const centreY = ys.length ? ys.reduce((a, b) => a + b, 0) / ys.length : top + 40;
    const boxH = Math.max(34, Math.min(96, placed.length * 9 + 22));
    const boxY = centreY - boxH / 2;

    // feed line into the splitter
    if (source){
      parts.push(`<path d="M ${n(source.x)} ${n(source.y)} L ${n(boxX - 14)} ${n(source.y)} L ${n(boxX - 14)} ${n(centreY)} L ${n(boxX)} ${n(centreY)}" fill="none" stroke="${PALETTE.route}" stroke-width="1.4"/>`);
      parts.push(`<circle cx="${n(source.x)}" cy="${n(source.y)}" r="2.2" fill="${PALETTE.route}"/>`);
    }

    parts.push(`<rect x="${n(boxX)}" y="${n(boxY)}" width="${n(LAYOUT.splitterWidth)}" height="${n(boxH)}" rx="3" fill="${PALETTE.splitter}" stroke="${PALETTE.splitterEdge}" stroke-width="1.2"/>`);
    parts.push(text(boxX + LAYOUT.splitterWidth / 2, boxY + 14, String(splitter.ratio || "splitter"), { size: 11, weight: "700", anchor: "middle", family: "sans-serif" }));
    if (splitter.label){
      parts.push(text(boxX + LAYOUT.splitterWidth / 2, boxY + 25, String(splitter.label), { size: 7.5, fill: PALETTE.muted, anchor: "middle", family: "sans-serif" }));
    }

    // optical annotation, gated by the caller
    if (annotation){
      const values = annotation.splitters?.[splitter.id] || null;
      if (values){
        const lines = [];
        const inText = dbm(values.inputDbm);
        const thruText = dbm(values.throughDbm);
        const tapText = dbm(values.tapDbm);
        if (inText) lines.push(`in ${inText}`);
        if (thruText) lines.push(`thru ${thruText}`);
        if (tapText) lines.push(`tap ${tapText}`);
        lines.forEach((line, lineIndex) => {
          parts.push(text(boxX + LAYOUT.splitterWidth / 2, boxY + boxH - 22 + lineIndex * 8, line, { size: 7, fill: PALETTE.ink, anchor: "middle" }));
        });
        if (values.status){
          const colour = STATUS_COLOR[values.status] || PALETTE.muted;
          parts.push(`<rect x="${n(boxX + LAYOUT.splitterWidth / 2 - 26)}" y="${n(boxY + boxH + 3)}" width="52" height="12" rx="6" fill="${colour}"/>`);
          parts.push(text(boxX + LAYOUT.splitterWidth / 2, boxY + boxH + 12, String(values.status), { size: 7.5, fill: "#FFFFFF", anchor: "middle", weight: "700", family: "sans-serif" }));
        }
        if (!annotation.verified){
          parts.push(text(boxX + LAYOUT.splitterWidth / 2, boxY + boxH + 25, "UNVERIFIED", { size: 6.5, fill: PALETTE.unverified, anchor: "middle", weight: "700", family: "sans-serif" }));
        }
      }
    }

    // fan-out to each landed leg
    placed.forEach((target) => {
      const endX = target.at.side === "in" ? LAYOUT.leftStripX + LAYOUT.stripWidth : LAYOUT.rightStripX;
      const fromX = target.at.side === "in" ? boxX : boxX + LAYOUT.splitterWidth;
      const midX = target.at.side === "in" ? fromX - 12 : fromX + 12;
      parts.push(`<path d="M ${n(fromX)} ${n(centreY)} L ${n(midX)} ${n(centreY)} L ${n(midX)} ${n(target.at.y)} L ${n(endX)} ${n(target.at.y)}" fill="none" stroke="${PALETTE.route}" stroke-width="1.1"/>`);
      parts.push(`<circle cx="${n(endX)}" cy="${n(target.at.y)}" r="2" fill="${PALETTE.route}"/>`);
    });

    // legs that leave on a secondary cable get a dashed arrow with its heading
    targets.filter((t) => t.at && t.at.y === null).forEach((target, offset) => {
      const cable = outCables[target.at.cableIndex];
      const y = centreY + 16 + offset * 11;
      const startX = boxX + LAYOUT.splitterWidth;
      parts.push(`<path d="M ${n(startX)} ${n(centreY)} L ${n(startX + 26)} ${n(y)}" fill="none" stroke="${PALETTE.route}" stroke-width="1" stroke-dasharray="3 2" marker-end="url(#fdArrow)"/>`);
      parts.push(text(startX + 30, y + 3, `${target.leg} → ${cable.heading || cable.id || "secondary"}`, { size: 7, fill: PALETTE.route }));
    });

    // A leg that lands on no fiber is not necessarily missing: it may feed a
    // downstream splitter or a local drop. Resolve those before reporting a gap,
    // so a real gap still stands out.
    targets.filter((t) => !t.at).forEach((target, offset) => {
      const y = centreY + 16 + offset * 11;
      const feeds = splitters.find((other) => {
        const otherSource = String(other.sourceLabel || "")
          || String(other.inputLabel || "").replace(/,([^,]*)$/, ":$1");
        return other !== splitter && otherSource === target.label;
      });
      const drop = (Array.isArray(pole.drops) ? pole.drops : []).find((candidate) => {
        const dropLabel = candidate.label
          || (candidate.inputLabel && candidate.leg ? `${candidate.inputLabel}:${candidate.leg}` : null);
        return dropLabel === target.label;
      });
      const note = feeds
        ? `${target.leg} → ${feeds.ratio || "splitter"}${feeds.label ? ` (${feeds.label})` : ""}`
        : drop
          ? `${target.leg} → ${drop.address || "drop"}`
          : `${target.leg} → not in any cable string`;
      const colour = feeds || drop ? PALETTE.route : PALETTE.muted;
      parts.push(`<path d="M ${n(boxX + LAYOUT.splitterWidth)} ${n(centreY)} L ${n(boxX + LAYOUT.splitterWidth + 6)} ${n(y)}" fill="none" stroke="${colour}" stroke-width="1" stroke-dasharray="1 2"/>`);
      parts.push(text(boxX + LAYOUT.splitterWidth + 10, y + 3, note, { size: 7, fill: colour }));
    });
  });

  return parts.join("\n");
}

/** Express runs: the same label present on both the IN and primary OUT cable. */
function renderExpress(inCable, outCables, geometry){
  if (!inCable) return "";
  const primary = outCables.find((cable) => cable.primary);
  if (!primary) return "";
  const { top, rowHeight } = geometry;
  const parts = [];
  const outByLabel = new Map(primary.parsed.assignments.map((a) => [a.label, a]));

  for (const assignment of inCable.parsed.assignments){
    if (assignment.kind === "XD") continue;
    const match = outByLabel.get(assignment.label);
    if (!match) continue;
    const y1 = rowY(assignment.fiber, top, rowHeight);
    const y2 = rowY(match.fiber, top, rowHeight);
    const x1 = LAYOUT.leftStripX + LAYOUT.stripWidth;
    const x2 = LAYOUT.rightStripX;
    const mid = (x1 + x2) / 2;
    parts.push(`<path d="M ${n(x1)} ${n(y1)} L ${n(mid)} ${n(y1)} L ${n(mid)} ${n(y2)} L ${n(x2)} ${n(y2)}" fill="none" stroke="${PALETTE.route}" stroke-width="1" opacity="0.85"/>`);
    parts.push(`<circle cx="${n(x1)}" cy="${n(y1)}" r="2" fill="${PALETTE.route}"/>`);
    parts.push(`<circle cx="${n(x2)}" cy="${n(y2)}" r="2" fill="${PALETTE.route}"/>`);
  }
  return parts.join("\n");
}

function renderDrops(pole, inCable, outCables, geometry){
  const drops = Array.isArray(pole.drops) ? pole.drops : [];
  if (!drops.length) return "";
  const parts = [];
  drops.forEach((drop, index) => {
    const label = drop.label || (drop.inputLabel && drop.leg ? `${drop.inputLabel}:${drop.leg}` : null);
    const at = label ? locate(label, inCable, outCables, geometry) : null;
    const y = at && at.y !== null ? at.y : geometry.top + 24 + index * 26;
    const x = LAYOUT.routeRight - 116;
    parts.push(`<rect x="${n(x)}" y="${n(y - 9)}" width="112" height="18" rx="3" fill="#FFFFFF" stroke="${PALETTE.route}" stroke-width="1" stroke-dasharray="2 2"/>`);
    parts.push(text(x + 6, y + 3, `${drop.leg || "drop"} ${drop.address || ""}`.trim(), { size: 7.5, fill: PALETTE.ink }));
  });
  return parts.join("\n");
}

function renderLegend(y){
  const items = [
    ["Express / through", PALETTE.route, "solid"],
    ["Splitter", PALETTE.splitterEdge, "box"],
    ["Secondary cable", PALETTE.route, "dashed"],
    ["Drop", PALETTE.route, "dotted"],
  ];
  const parts = [text(LAYOUT.leftStripX, y, "LEGEND", { size: 8, weight: "700", fill: PALETTE.muted, family: "sans-serif" })];
  items.forEach(([label, colour, style], index) => {
    const x = LAYOUT.leftStripX + 60 + index * 150;
    if (style === "box"){
      parts.push(`<rect x="${n(x)}" y="${n(y - 7)}" width="16" height="10" rx="2" fill="${PALETTE.splitter}" stroke="${colour}" stroke-width="1"/>`);
    } else {
      const dash = style === "dashed" ? ` stroke-dasharray="3 2"` : style === "dotted" ? ` stroke-dasharray="1 2"` : "";
      parts.push(`<line x1="${n(x)}" y1="${n(y - 3)}" x2="${n(x + 18)}" y2="${n(y - 3)}" stroke="${colour}" stroke-width="1.4"${dash}/>`);
    }
    parts.push(text(x + 24, y, label, { size: 8, fill: PALETTE.muted, family: "sans-serif" }));
  });
  return parts.join("\n");
}

/**
 * Render a pole's splice diagram as an SVG string.
 *
 * @param {object} pole
 * @param {string} pole.name              e.g. "POLE 1748"
 * @param {string} [pole.enclosure]       e.g. "FOSC 450 B6"
 * @param {object} pole.cableIn           {id, string, fiberCount?, tubeSize?}
 * @param {Array}  [pole.cablesOut]       [{id, string, heading?, primary?}]
 * @param {Array}  [pole.splitters]       [{id, ratio, inputLabel, outputs[], label?}]
 * @param {Array}  [pole.drops]           [{leg, address, inputLabel?}]
 * @param {object} [options]
 * @param {object} [options.annotations]  {verified, splitters:{[id]:{inputDbm,throughDbm,tapDbm,status}}}
 * @param {boolean}[options.showUnverified] draw unverified values (each labelled)
 * @returns {string} SVG document
 */
export function renderSpliceDiagram(pole, options = {}){
  if (!pole || typeof pole !== "object"){
    throw new SpliceDiagramError("A pole object is required.", { pole });
  }
  const inCable = parseCable(pole.cableIn, "IN");
  if (!inCable){
    throw new SpliceDiagramError("A pole needs an IN cable to render a splice diagram.", { pole });
  }
  const outCables = (Array.isArray(pole.cablesOut) ? pole.cablesOut : [])
    .map((cable, index) => parseCable({ primary: index === 0, ...cable }, `OUT[${index}]`));

  const primary = outCables.find((cable) => cable.primary) || null;
  const rows = Math.max(inCable.parsed.fiberCount, primary ? primary.parsed.fiberCount : 0);
  const { rowHeight, headerHeight, footerHeight } = LAYOUT;
  const top = headerHeight;
  const height = headerHeight + rows * rowHeight + footerHeight;
  const geometry = { top, rowHeight };

  // annotation gate: unverified values are withheld unless explicitly opted in,
  // and are labelled UNVERIFIED whenever they are drawn
  const rawAnnotations = options.annotations || null;
  const annotation = !rawAnnotations
    ? null
    : (rawAnnotations.verified === true || options.showUnverified === true ? rawAnnotations : null);

  const title = `${pole.name || pole.id || "POLE"}${pole.enclosure ? ` — ${pole.enclosure}` : ""}`;
  const inTubes = describeCableBuild(inCable.build);

  const svg = [];
  svg.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${LAYOUT.width}" height="${n(height)}" viewBox="0 0 ${LAYOUT.width} ${n(height)}" font-family="sans-serif">`);
  svg.push(`<defs><marker id="fdArrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M 0 0 L 8 4 L 0 8 z" fill="${PALETTE.route}"/></marker></defs>`);
  svg.push(`<rect width="${LAYOUT.width}" height="${n(height)}" fill="${PALETTE.paper}"/>`);

  svg.push(text(LAYOUT.leftStripX, 30, title, { size: 17, weight: "700", family: "sans-serif" }));
  svg.push(text(LAYOUT.leftStripX, 48, `IN ${inCable.id || "(unnamed)"} · ${inCable.build.fiberCount}ct · ${inTubes.length} x ${inCable.build.tubeSize}F tubes`, { size: 9, fill: PALETTE.muted, family: "sans-serif" }));
  if (primary){
    svg.push(text(LAYOUT.width - LAYOUT.leftStripX, 48, `OUT ${primary.id || "(unnamed)"}${primary.heading ? ` · ${primary.heading}` : ""}`, { size: 9, fill: PALETTE.muted, anchor: "end", family: "sans-serif" }));
  }
  svg.push(`<line x1="${LAYOUT.leftStripX}" y1="58" x2="${LAYOUT.width - LAYOUT.leftStripX}" y2="58" stroke="${PALETTE.rule}" stroke-width="1"/>`);

  svg.push(renderStrip(inCable, { x: LAYOUT.leftStripX, top, rowHeight, mirrored: false, title: "CABLE IN" }));
  if (primary){
    svg.push(renderStrip(primary, { x: LAYOUT.rightStripX, top, rowHeight, mirrored: true, title: "CABLE OUT" }));
  }

  svg.push(renderExpress(inCable, outCables, geometry));
  svg.push(renderSplitters(pole, inCable, outCables, geometry, annotation));
  svg.push(renderDrops(pole, inCable, outCables, geometry));

  const legendY = top + rows * rowHeight + 26;
  svg.push(renderLegend(legendY));

  if (rawAnnotations && !annotation){
    svg.push(text(LAYOUT.leftStripX, legendY + 18, "Optical values withheld: PCOT specifications are not verified.", { size: 8, fill: PALETTE.unverified, weight: "700", family: "sans-serif" }));
  }

  // source footnote: the raw strings this diagram was built from
  let footY = legendY + (rawAnnotations && !annotation ? 34 : 20);
  svg.push(text(LAYOUT.leftStripX, footY, "SOURCE", { size: 8, weight: "700", fill: PALETTE.muted, family: "sans-serif" }));
  footY += 11;
  svg.push(text(LAYOUT.leftStripX, footY, `IN  ${inCable.id || "(unnamed)"}  ${inCable.parsed.raw}`, { size: 7, fill: PALETTE.muted }));
  outCables.forEach((cable) => {
    footY += 10;
    svg.push(text(LAYOUT.leftStripX, footY, `OUT ${cable.id || "(unnamed)"}${cable.heading ? ` (${cable.heading})` : ""}  ${cable.parsed.raw}`, { size: 7, fill: PALETTE.muted }));
  });

  svg.push("</svg>");
  return svg.filter(Boolean).join("\n");
}
