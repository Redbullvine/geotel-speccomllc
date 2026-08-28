/**
 * Fiber Engineer — assemble splice-diagram poles from imported TDS topology.
 *
 * Consumes the output of extractTdsDesign() (services/ebc/tdsKmzImport.mjs) and
 * groups its cables onto the network points they terminate at, so each pole can
 * be handed to renderSpliceDiagram().
 *
 * Direction is never guessed. A cable is only labelled IN when the design data
 * says so — either because the splitter cascade orders it upstream, or because
 * a human named it. When direction cannot be established the pole is returned
 * with `directionResolved: false` and a warning, and the UI asks rather than
 * inventing an answer.
 *
 * No DOM, no I/O.
 */

import { parseCableString } from "./cableString.mjs";
import { inferTubeSize } from "./fiberColors.mjs";

export const POLE_SOURCE = Object.freeze({
  /** Derived from the imported TDS design export. */
  TDS_IMPORT: "TDS_IMPORT",
  /** Connectivity strings typed by a human in the Fiber Engineer. */
  MANUAL_ENTRY: "MANUAL_ENTRY",
});

/** Cable count from a TDS labor unit such as "CO(48)(FD)6M" -> 48. */
export function fiberCountFromLaborUnit(laborUnit){
  const match = String(laborUnit || "").match(/\((\d{2,3})\)/);
  if (!match) return null;
  const count = Number.parseInt(match[1], 10);
  return Number.isFinite(count) && count > 0 ? count : null;
}

function cableBuild(cable){
  const fiberCount = fiberCountFromLaborUnit(cable?.laborUnit);
  if (!fiberCount) return {};
  return { fiberCount, tubeSize: inferTubeSize(fiberCount) || fiberCount };
}

/**
 * Group the design's cables onto their network points.
 * @returns {{poles: Array, warnings: string[]}}
 */
export function buildSplicePoles(design, options = {}){
  const warnings = [];
  const cables = Array.isArray(design?.cables) ? design.cables : [];
  const cpToNp = design?.cpToNp || {};
  const networkPoints = new Map(
    (Array.isArray(design?.networkPoints) ? design.networkPoints : []).map((np) => [String(np.np), np]),
  );

  // splitter devices, indexed by the network point they sit at
  const devicesByNp = new Map();
  for (const device of (Array.isArray(design?.devices) ? design.devices : [])){
    // devices carry their network point directly; fall back to the CP map
    const np = String(device.np ?? cpToNp[String(device.cp)] ?? "");
    if (!np) continue;
    if (!devicesByNp.has(np)) devicesByNp.set(np, []);
    devicesByNp.get(np).push(device);
  }

  const byNp = new Map();
  for (const cable of cables){
    if (!cable?.cableCount) continue; // no connectivity string, nothing to draw
    for (const endpoint of [cable.startCp, cable.endCp]){
      const np = String(cpToNp[String(endpoint)] ?? "");
      if (!np) continue;
      if (!byNp.has(np)) byNp.set(np, []);
      byNp.get(np).push(cable);
    }
  }

  const poles = [];
  for (const [np, attached] of [...byNp.entries()].sort((a, b) => a[0].localeCompare(b[0], "en"))){
    // de-duplicate: a cable with both ends on one point appears twice
    const unique = [];
    const seen = new Set();
    for (const cable of attached){
      if (seen.has(cable.name)) continue;
      seen.add(cable.name);
      unique.push(cable);
    }

    const parsedCables = [];
    for (const cable of unique){
      const build = cableBuild(cable);
      let parseError = null;
      try {
        parseCableString(cable.cableCount, { expectedFiberCount: build.fiberCount });
      } catch (error){
        parseError = error.message;
        warnings.push(`Pole ${np}: cable ${cable.name} — ${error.message}`);
      }
      parsedCables.push({
        id: cable.name,
        string: cable.cableCount,
        footage: cable.footage ?? null,
        laborUnit: cable.laborUnit || null,
        ...build,
        parseError,
      });
    }

    const point = networkPoints.get(np) || null;
    const devices = devicesByNp.get(np) || [];

    // An endpoint that resolves to no network-point record is not a pole. It
    // still becomes an entry so its cables are not silently lost, but it is
    // flagged so a consumer that draws poles on a map can leave it out rather
    // than labelling a connectivity point "POLE 12801".
    if (!point){
      warnings.push(`${np} is used as a cable endpoint but is not a network point in this export; it is not a pole.`);
    }

    // extractTdsDesign() records a network point's position as `coords`; the
    // flat lat/lng form is accepted too for hand-built input.
    const coords = point?.coords || point || null;

    poles.push({
      id: np,
      name: `POLE ${np}`,
      isNetworkPoint: Boolean(point),
      enclosure: point?.type || null,
      lat: coords?.lat ?? null,
      lng: coords?.lng ?? null,
      source: POLE_SOURCE.TDS_IMPORT,
      cables: parsedCables,
      splitters: splittersFromDevices(devices),
      // IN/OUT is a design fact we do not have directly; the caller resolves it
      directionResolved: false,
      cableIn: null,
      cablesOut: [],
      parseErrors: parsedCables.filter((cable) => cable.parseError).length,
    });
  }

  return { poles, warnings };
}

/**
 * Turn TDS tap devices into renderer splitter descriptors.
 *
 * Each device record is one *position* on a splitter, carrying the cascade it
 * belongs to (node, pon, branch) plus its own position. Grouping by that
 * cascade reconstructs the splitter and its output legs. The ratio comes from
 * the device's own Splitter Ratio field, never from the number of positions
 * present — a partially exported splitter must not silently shrink.
 */
export function splittersFromDevices(devices){
  const groups = new Map();
  for (const device of (Array.isArray(devices) ? devices : [])){
    const node = String(device.node || "").trim();
    const pon = String(device.pon || "").trim();
    const branch = String(device.branch || "").trim();
    const position = String(device.position || "").trim();
    if (!node || !pon || !branch || !position) continue;
    const inputLabel = `${node},${pon},${branch}`;
    if (!groups.has(inputLabel)){
      groups.set(inputLabel, {
        inputLabel,
        ratios: new Set(),
        positions: new Set(),
        devices: [],
      });
    }
    const group = groups.get(inputLabel);
    group.positions.add(position);
    group.devices.push(device.deviceName || null);
    const ratio = device.splitterRatio ?? device.tapRatio;
    if (ratio !== null && ratio !== undefined && String(ratio).trim() !== ""){
      group.ratios.add(String(ratio).trim());
    }
  }

  return [...groups.values()]
    .map((group) => {
      const ratios = [...group.ratios].sort((a, b) => a.localeCompare(b, "en"));
      const ratio = ratios.length === 1 ? ratios[0] : null;
      return {
        id: group.inputLabel,
        ratio: ratio === null
          ? "splitter"
          : (/^1x/i.test(ratio) ? ratio.toLowerCase() : `1x${ratio.replace(/\D/g, "")}`),
        label: group.inputLabel.split(",").pop(),
        inputLabel: group.inputLabel,
        outputs: [...group.positions].sort((a, b) => a.localeCompare(b, "en", { numeric: true })),
        deviceCount: group.devices.length,
        // more than one declared ratio on one splitter is a design conflict
        ratioConflict: ratios.length > 1 ? ratios : null,
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id, "en"));
}

/**
 * Name which attached cable is the feed. Returns a new pole; never mutates.
 * @param {object} pole from buildSplicePoles
 * @param {string} inCableId
 */
export function resolveDirection(pole, inCableId, options = {}){
  const cables = Array.isArray(pole?.cables) ? pole.cables : [];
  const inCable = cables.find((cable) => cable.id === inCableId);
  if (!inCable){
    throw new Error(`Cable "${inCableId}" is not attached to pole ${pole?.id}.`);
  }
  const rest = cables.filter((cable) => cable.id !== inCableId);
  const primaryId = options.primaryOutId || rest[0]?.id || null;
  return {
    ...pole,
    directionResolved: true,
    cableIn: inCable,
    cablesOut: rest.map((cable) => ({
      ...cable,
      primary: cable.id === primaryId,
      heading: options.headings?.[cable.id] || cable.heading || null,
    })),
  };
}

/**
 * Build a pole straight from typed connectivity strings, for designs whose
 * export carries no "Cable Count" field.
 */
export function buildManualPole({ name, enclosure, inCable, outCables = [], splitters = [], drops = [] } = {}){
  if (!inCable?.string){
    throw new Error("A manual pole needs an IN cable connectivity string.");
  }
  parseCableString(inCable.string, { expectedFiberCount: inCable.fiberCount ?? undefined });
  for (const cable of outCables){
    parseCableString(cable.string, { expectedFiberCount: cable.fiberCount ?? undefined });
  }
  return {
    id: String(name || "manual"),
    name: name || "POLE",
    enclosure: enclosure || null,
    source: POLE_SOURCE.MANUAL_ENTRY,
    directionResolved: true,
    cableIn: inCable,
    cablesOut: outCables.map((cable, index) => ({ primary: index === 0, ...cable })),
    splitters,
    drops,
  };
}
