/**
 * EBC — TDS KMZ/KML design importer.
 *
 * Generic. Nothing here knows about Node 54, 1635CA or P0002; those are
 * discovered from the file. Node 54 is simply the first project this importer
 * has been validated against, and its extracted output is checked by the test
 * suite so a regression in this parser is caught against known-good values.
 *
 * INPUT: the doc.kml text from inside a TDS .kmz. Unzipping is the caller's
 * job (tools/import_tds_kmz.mjs does it in Node) because this module is also
 * loaded in the browser and must stay dependency-free.
 *
 * TDS puts its attributes in an HTML table inside each placemark's CDATA
 * description, as <tr><td>Field</td><td>Value</td></tr>. There is no KML
 * <Schema>/<SimpleField> block and no <Data> elements on design records, so
 * row scraping is the only available route.
 *
 * WHAT THIS IMPORTER DELIBERATELY DOES NOT DO: infer optical loss. The TDS
 * export contains no dB value for any device — its only loss-shaped field,
 * "Collective Tap Loss Value At Splitter", is null or zero throughout. The
 * importer records that field verbatim so a future export carrying real values
 * is picked up automatically, and reports `containsInsertionLoss: false` when
 * it does not.
 */

/** TDS attribute names this importer consumes, grouped by record type. */
export const TDS_FIELDS = Object.freeze({
  device: Object.freeze({
    name: "Network Device Name",
    type: "Network Device Type",
    materialUnit: "Material Unit",
    materialAmount: "Material Unit Amount",
    connectivityPoint: "Connectivity Point Name",
    splitterPath: "Splitter Path",
    splitterOrder: "Splitter Order",
    splitterRatio: "Splitter Ratio",
    tapRatio: "Optical Tap Ratio",
    tapLoss: "Collective Tap Loss Value At Splitter",
    installedOnOrder: "InstalledOnOrderIndicator",
    project: "Project",
    node: "Node",
    market: "MarketName",
    errorFlag: "Potential Error Flag",
    committed: "Committed to Record",
    createdDate: "Created Date",
    modifiedDate: "Last Modified Date",
    globalId: "GLOBALID",
  }),
  connectivityPoint: Object.freeze({
    name: "Connectivity Point Name",
    networkPoint: "Network Point Connectivity Point Is Located At",
  }),
  cable: Object.freeze({
    name: "Cable Name",
    startCp: "Connectivity Point ID Where Cable Starts",
    endCp: "Connectivity Point ID Where Cable Ends",
    materialUnit: "Material Unit",
    laborUnit: "Labor or Labor/Material Unit",
    laborAmount: "Labor or Labor/Material Amount",
    cableCount: "Cable Count",
    cableType: "Cable Type",
    transport: "Cable Carries Unsplit Fiber Back to Node (Transport)",
    project: "Project",
    node: "Node",
  }),
  networkPoint: Object.freeze({
    name: "Network Point Name",
    type: "Network Point Type",
    project: "Project",
  }),
  path: Object.freeze({
    name: "Path Name",
    startNp: "Path Start Network Point Name",
    endNp: "Path End Network Point Name",
    geodeticLength: "Geodetic Length",
    status: "Current Path Status",
  }),
});

const ENTITIES = [
  ["&lt;", "<"], ["&gt;", ">"], ["&quot;", '"'], ["&#39;", "'"], ["&apos;", "'"], ["&amp;", "&"],
];

function decodeEntities(text){
  let value = String(text);
  for (const [from, to] of ENTITIES) value = value.split(from).join(to);
  return value.replace(/\s+/g, " ").trim();
}

const NULLISH = new Set(["", "<null>", "null", "n/a", "na"]);

/** TDS writes absent values as the literal string "<Null>". */
export function tdsValue(raw){
  const value = decodeEntities(raw ?? "");
  return NULLISH.has(value.toLowerCase()) ? null : value;
}

/** Trailing integer of an identifier: "RuidosoConnectivityPoint-12917" -> "12917". */
export function tdsIdNumber(name){
  const match = /(\d+)\s*$/.exec(String(name || ""));
  return match ? match[1] : "";
}

function toNumber(value){
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

/**
 * Parse every placemark into { fields, point, line }.
 * Field values keep TDS's own names; `tdsValue` has already normalised <Null>.
 */
export function parseTdsKml(kmlText){
  const text = String(kmlText || "");
  const chunks = text.split("<Placemark").slice(1);
  const placemarks = [];

  for (const rawChunk of chunks){
    // Some TDS exports put the description table in the CDATA as literal HTML;
    // others escape it (&lt;tr&gt;...). Unescape only when the chunk carries no
    // real rows, so exports that already hold raw HTML parse exactly as before.
    const chunk = /<tr[^>]*>/.test(rawChunk) || !/&lt;tr/i.test(rawChunk)
      ? rawChunk
      : rawChunk.replace(/&lt;/g, "<").replace(/&gt;/g, ">");
    const fields = {};
    for (const row of chunk.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)){
      const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)]
        .map((cell) => decodeEntities(cell[1].replace(/<[^>]*>/g, "")));
      if (cells.length !== 2) continue;
      const key = cells[0];
      if (!key || key.length > 80) continue;
      if (fields[key] === undefined) fields[key] = tdsValue(cells[1]);
    }
    // KML <Data name="x"><value>y</value></Data>, used by analysis overlays.
    for (const data of chunk.matchAll(/<Data name="([^"]+)"[^>]*>\s*<value>([\s\S]*?)<\/value>/g)){
      const key = decodeEntities(data[1]);
      if (fields[key] === undefined) fields[key] = tdsValue(data[2]);
    }

    const pointMatch = /<Point>[\s\S]*?<coordinates>([^<]+)<\/coordinates>/.exec(chunk);
    const lineMatch = /<LineString>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/.exec(chunk);
    placemarks.push({
      fields,
      point: pointMatch ? parseCoordinate(pointMatch[1]) : null,
      line: lineMatch ? lineMatch[1].trim().split(/\s+/).map(parseCoordinate).filter(Boolean) : null,
    });
  }
  return placemarks;
}

function parseCoordinate(raw){
  const parts = String(raw || "").trim().split(",");
  if (parts.length < 2) return null;
  const lng = Number(parts[0]);
  const lat = Number(parts[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat: Number(lat.toFixed(8)), lng: Number(lng.toFixed(8)) };
}

/** "1635CA,P0002,S4:L1" -> { node, pon, branch, position, order } */
export function parseSplitterPath(splitterPath){
  const raw = String(splitterPath || "").trim();
  if (!raw) return null;
  const parts = raw.split(",").map((part) => part.trim());
  if (parts.length < 3) return null;
  const [node, pon, segment] = parts;
  const [branch, position = ""] = segment.split(":");
  const order = position ? Number(position.replace(/\D/g, "")) : null;
  return {
    node, pon, branch, position,
    order: Number.isFinite(order) ? order : null,
    key: node + "|" + pon + "|" + branch,
  };
}

/**
 * Extract the design from a TDS KML.
 *
 * Optional filters narrow the result; with none supplied every project and PON
 * present in the file is returned.
 */
export function extractTdsDesign(kmlText, { project = "", pon = "", node = "" } = {}){
  const placemarks = parseTdsKml(kmlText);
  const D = TDS_FIELDS.device;
  const C = TDS_FIELDS.connectivityPoint;
  const B = TDS_FIELDS.cable;
  const N = TDS_FIELDS.networkPoint;

  const warnings = [];

  // --- Connectivity point -> network point -------------------------------
  const cpToNp = new Map();
  for (const mark of placemarks){
    const cp = mark.fields[C.name];
    const np = mark.fields[C.networkPoint];
    // Device records also carry a Connectivity Point Name; only the
    // connectivity-point records themselves carry the network-point link.
    if (cp && np && !mark.fields[D.splitterPath]) cpToNp.set(tdsIdNumber(cp), tdsIdNumber(np));
  }

  // --- Cable graph --------------------------------------------------------
  const cables = [];
  const adjacency = new Map();
  const edges = new Map();
  for (const mark of placemarks){
    if (!mark.fields[B.name] || !mark.fields[B.startCp]) continue;
    const startCp = tdsIdNumber(mark.fields[B.startCp]);
    const endCp = tdsIdNumber(mark.fields[B.endCp]);
    if (!startCp || !endCp) continue;
    const record = {
      name: mark.fields[B.name],
      startCp, endCp,
      footage: toNumber(mark.fields[B.laborAmount]),
      laborUnit: mark.fields[B.laborUnit] || null,
      materialUnit: mark.fields[B.materialUnit] || null,
      cableCount: mark.fields[B.cableCount] || null,
      cableType: mark.fields[B.cableType] || null,
      transport: mark.fields[B.transport] || null,
      project: mark.fields[B.project] || null,
      geometry: mark.line || null,
    };
    cables.push(record);
    if (!adjacency.has(startCp)) adjacency.set(startCp, new Set());
    if (!adjacency.has(endCp)) adjacency.set(endCp, new Set());
    adjacency.get(startCp).add(endCp);
    adjacency.get(endCp).add(startCp);
    edges.set(startCp + "|" + endCp, record);
    edges.set(endCp + "|" + startCp, record);
  }

  // --- Network points -----------------------------------------------------
  const networkPoints = new Map();
  for (const mark of placemarks){
    const name = mark.fields[N.name];
    if (!name) continue;
    networkPoints.set(tdsIdNumber(name), {
      np: tdsIdNumber(name),
      name,
      type: mark.fields[N.type] || null,
      project: mark.fields[N.project] || null,
      coords: mark.point,
    });
  }

  // --- Tap devices --------------------------------------------------------
  const devices = [];
  for (const mark of placemarks){
    const splitterPath = mark.fields[D.splitterPath];
    if (!splitterPath) continue;
    const parsed = parseSplitterPath(splitterPath);
    if (!parsed) continue;
    if (project && mark.fields[D.project] !== project) continue;
    if (pon && parsed.pon !== pon) continue;
    if (node && parsed.node !== node) continue;

    const cp = tdsIdNumber(mark.fields[D.connectivityPoint]);
    devices.push({
      deviceName: mark.fields[D.name] || null,
      deviceType: mark.fields[D.type] || null,
      project: mark.fields[D.project] || null,
      node: parsed.node,
      pon: parsed.pon,
      branch: parsed.branch,
      position: parsed.position,
      order: parsed.order,
      splitterOrder: toNumber(mark.fields[D.splitterOrder]),
      splitterRatio: toNumber(mark.fields[D.splitterRatio]),
      tapRatio: mark.fields[D.tapRatio] || null,
      catalogueDescription: mark.fields[D.materialUnit] || null,
      materialAmount: toNumber(mark.fields[D.materialAmount]),
      declaredTapLoss: mark.fields[D.tapLoss],
      cp,
      np: cpToNp.get(cp) || "",
      coords: mark.point,
      market: mark.fields[D.market] || null,
      installedOnOrder: mark.fields[D.installedOnOrder] || null,
      committedToRecord: mark.fields[D.committed] || null,
      errorFlag: mark.fields[D.errorFlag] || null,
      createdDate: mark.fields[D.createdDate] || null,
      modifiedDate: mark.fields[D.modifiedDate] || null,
      globalId: mark.fields[D.globalId] || null,
    });
  }

  // Does this export carry ANY optical loss at all?
  const declaredLosses = devices.map((device) => toNumber(device.declaredTapLoss)).filter((value) => value !== null && value !== 0);
  const containsInsertionLoss = declaredLosses.length > 0;

  // --- Group into legs ----------------------------------------------------
  const legs = new Map();
  for (const device of devices){
    if (!device.tapRatio) continue;
    const key = device.node + "|" + device.pon + "|" + device.branch;
    if (!legs.has(key)){
      legs.set(key, { key, project: device.project, node: device.node, pon: device.pon, branch: device.branch, nodes: [] });
    }
    legs.get(key).nodes.push(device);
  }

  const tapCpsByLeg = new Map();
  for (const leg of legs.values()){
    leg.nodes.sort((a, b) => {
      if (a.order !== null && b.order !== null && a.order !== b.order) return a.order - b.order;
      return String(a.position).localeCompare(String(b.position));
    });
    tapCpsByLeg.set(leg.key, new Set(leg.nodes.map((item) => item.cp)));
  }

  const allTapCps = new Set(devices.map((device) => device.cp));

  for (const leg of legs.values()){
    // Positions should run L1..Ln with no gaps; a gap means a location is
    // missing from the export and the cascade cannot be trusted end to end.
    const orders = leg.nodes.map((item) => item.order).filter((value) => value !== null);
    const sequential = orders.every((value, index) => value === index + 1);
    leg.positionsSequential = sequential;
    if (!sequential){
      warnings.push("Leg " + leg.key + " positions are not sequential (" + leg.nodes.map((n) => n.position).join(", ") + "); a location may be missing from the export.");
    }

    // Span footage between consecutive taps, from the direct cable.
    for (let index = 0; index < leg.nodes.length; index += 1){
      const current = leg.nodes[index];
      const previous = index === 0 ? null : leg.nodes[index - 1];
      if (previous){
        const edge = edges.get(previous.cp + "|" + current.cp);
        current.spanFeetFromPrevious = edge ? edge.footage : null;
        current.spanCableName = edge ? edge.name : null;
        current.directlyCabledToPrevious = Boolean(edge);
        if (!edge){
          warnings.push("Leg " + leg.key + ": " + previous.position + " and " + current.position + " are not joined by a single direct cable; span footage is unavailable.");
        }
      }
    }

    // Head of the leg: the neighbour of the first tap that is not itself a tap.
    const first = leg.nodes[0];
    if (first){
      const neighbours = [...(adjacency.get(first.cp) || [])];
      const legTaps = tapCpsByLeg.get(leg.key);
      const candidates = neighbours.filter((cp) => !legTaps.has(cp));
      const upstream = candidates.filter((cp) => !allTapCps.has(cp));
      const chosen = upstream.length === 1 ? upstream[0] : (candidates.length === 1 ? candidates[0] : "");
      if (chosen){
        const edge = edges.get(chosen + "|" + first.cp);
        leg.head = { cp: chosen, np: cpToNp.get(chosen) || "", spanFeetToFirst: edge ? edge.footage : null, cableName: edge ? edge.name : null };
        first.spanFeetFromPrevious = edge ? edge.footage : null;
        first.spanCableName = edge ? edge.name : null;
        first.directlyCabledToPrevious = Boolean(edge);
      } else {
        leg.head = null;
        first.spanFeetFromPrevious = null;
        first.directlyCabledToPrevious = false;
        warnings.push("Leg " + leg.key + ": could not identify a single upstream feed for " + first.position + " (" + candidates.length + " candidate connection(s)); head span is unavailable.");
      }
    }
  }

  const projects = [...new Set(devices.map((device) => device.project).filter(Boolean))].sort();
  const pons = [...new Set(devices.map((device) => device.node + "/" + device.pon))].sort();

  return {
    placemarkCount: placemarks.length,
    projects,
    pons,
    devices,
    cables,
    networkPoints: [...networkPoints.values()],
    cpToNp: Object.fromEntries(cpToNp),
    legs: [...legs.values()],
    containsInsertionLoss,
    lossFieldName: TDS_FIELDS.device.tapLoss,
    lossFieldSummary: summariseLossField(devices),
    catalogueDescriptions: [...new Set(devices.map((device) => device.catalogueDescription).filter(Boolean))].sort(),
    warnings,
  };
}

function summariseLossField(devices){
  const counts = new Map();
  for (const device of devices){
    const key = device.declaredTapLoss === null ? "<Null>" : String(device.declaredTapLoss);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([value, count]) => ({ value, count }));
}

/**
 * Turn one extracted leg into the shape the optical budget engine consumes.
 * Every engineering constant the TDS export does not supply is left null.
 */
export function tdsLegToEbcLeg(leg, { projectName = "", wavelengthNm = null } = {}){
  return {
    legId: leg.branch,
    label: leg.node + " " + leg.pon + " " + leg.branch,
    projectId: leg.project || "",
    projectName: projectName || leg.project || "",
    nodeName: leg.node,
    pon: leg.pon,
    wavelengthNm,
    launch: {
      powerDbm: null,
      provenance: null,
      reference: leg.head
        ? "Measure at NP" + (leg.head.np || "?") + " / CP" + leg.head.cp + ", the documented feed for this leg."
        : "No single upstream feed could be identified for this leg; supply the measured power at its head.",
      referenceStopId: leg.head ? leg.head.cp : "",
    },
    fiber: { attenuationDbPerKm: null, attenuationDbPerMile: null, distanceUnit: "ft" },
    defaults: { spliceLossDb: null, connectorLossDb: null },
    limits: { receiverMinDbm: null, receiverMaxDbm: null, engineeringReserveDb: null },
    nodes: leg.nodes.map((device) => ({
      id: "np" + device.np,
      label: "PCOT " + (device.np || device.cp),
      np: device.np,
      cp: device.cp,
      type: "pcot",
      designedRatio: device.tapRatio,
      designedRatioSource: "TDS_PROJECT_EXPORT",
      installedRatio: null,
      tdsPosition: device.position,
      partNumber: device.catalogueDescription,
      splitterRatio: device.splitterRatio,
      designCoords: device.coords,
      span: {
        distance: device.spanFeetFromPrevious ?? null,
        distanceUnit: device.spanFeetFromPrevious === null || device.spanFeetFromPrevious === undefined ? null : "ft",
        distanceSource: device.spanFeetFromPrevious === null || device.spanFeetFromPrevious === undefined ? null : "TDS_CABLE_PLACEMENT_FOOTAGE",
        spliceCount: null,
        connectorCount: null,
      },
      measured: null,
    })),
  };
}
