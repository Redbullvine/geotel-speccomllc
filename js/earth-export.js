/**
 * Context KMZ export — "Open in Google Earth" for a single location.
 *
 * A single dropped pin is useless in the field: the splicer needs to see where
 * he is relative to the neighbouring poles, read their pole numbers, and tell
 * at a glance what kind of splitter or tap sits at each one. This module builds
 * the KML for that context view and (given a zip factory) packages it as a
 * .kmz that Google Earth opens on iOS, Android, desktop and earth.google.com.
 *
 * SOURCE FACTS (TDS Project.kmz — engineering record, not inference):
 *   Pole number is the numeric suffix of the Network Point name:
 *     RuidosoNetworkPoint-1654 -> pole 1654. Same numbers the FADs use.
 *   Splice enclosures are Connectivity Points; each carries
 *     "Network Point Connectivity Point Is Located At RuidosoNetworkPoint-####"
 *     which is how a location is tied to its pole.
 *   Network Devices carry the splitter/tap identity:
 *     Material Unit "Splitter(1x8)"                     -> 1x8 splitter
 *     Material Unit "Splitter(1x4)"                     -> 1x4 splitter
 *     Material Unit "HxFO(1x2)PCOT(..)"  (Device Type 2) -> 1x2 PCOT tap
 *     Material Unit "HxFO(1x4)PCOT(..)"  (Device Type 2) -> 1x4 PCOT tap
 *     Device Type 1 + Material Unit N/A + Splitter Order 3
 *       + Splitter Ratio 2 / 4                          -> tap leg (1x2 / 1x4)
 *     Enclosure Unit "HAFO(PCOT)LO" with no device      -> pass-through / MST only
 *
 * THE STANDING RULE: when none of those fields resolve cleanly the location is
 * UNKNOWN and exports gray with a "?" suffix. This module never fills in a
 * plausible value.
 *
 * No DOM, no network, no zip dependency of its own — buildContextKmz() takes a
 * zip factory from the caller so this file stays loadable in Node for tests.
 */

/* ==========================================================================
   Types and the engineer's own colour table
   ========================================================================== */

export const EARTH_TYPES = Object.freeze({
  SPLITTER_1X8: "SPLITTER_1X8",
  SPLITTER_1X4: "SPLITTER_1X4",
  PCOT_TAP_1X2: "PCOT_TAP_1X2",
  PCOT_TAP_1X4: "PCOT_TAP_1X4",
  TAP_LEG_1X2: "TAP_LEG_1X2",
  TAP_LEG_1X4: "TAP_LEG_1X4",
  PASS_THROUGH: "PASS_THROUGH",
  POLE: "POLE",
  UNKNOWN: "UNKNOWN",
});

/**
 * Hosted Google icons, so nothing has to be packaged inside the .kmz.
 *
 * Every paddle pin uses the WHITE paddle as its base and carries the engineer's
 * exact aabbggrr colour in <IconStyle><color>. Google Earth multiplies that
 * colour into the icon texture, so a white base reproduces the colour exactly —
 * including the two the hosted paddle set has no file for (the darker cyan used
 * for a 1x4 tap, and the gray used for UNKNOWN). Picking a differently-coloured
 * paddle file and then tinting it would multiply two colours together and land
 * somewhere the staking sheet never shows.
 */
export const EARTH_ICONS = Object.freeze({
  PIN: "http://maps.google.com/mapfiles/kml/paddle/wht-blank.png",
  DOT: "http://maps.google.com/mapfiles/kml/shapes/shaded_dot.png",
});

/** Colour / label table. `color` is KML aabbggrr, straight from the engineer's KMZ. */
export const EARTH_STYLE_TABLE = Object.freeze({
  [EARTH_TYPES.SPLITTER_1X8]: Object.freeze({ label: "1x8 splitter", color: "ff0000ff", icon: EARTH_ICONS.PIN, legend: "1x8 splitter — red" }),
  [EARTH_TYPES.SPLITTER_1X4]: Object.freeze({ label: "1x4 splitter", color: "ff00ff55", icon: EARTH_ICONS.PIN, legend: "1x4 splitter — green" }),
  [EARTH_TYPES.PCOT_TAP_1X2]: Object.freeze({ label: "1x2 tap", color: "ffffc500", icon: EARTH_ICONS.PIN, legend: "1x2 PCOT tap — cyan" }),
  [EARTH_TYPES.PCOT_TAP_1X4]: Object.freeze({ label: "1x4 tap", color: "ffe6a000", icon: EARTH_ICONS.PIN, legend: "1x4 PCOT tap — darker cyan" }),
  [EARTH_TYPES.TAP_LEG_1X2]: Object.freeze({ label: "1x2 leg", color: "ffe65c00", icon: EARTH_ICONS.PIN, legend: "tap leg — blue" }),
  [EARTH_TYPES.TAP_LEG_1X4]: Object.freeze({ label: "1x4 leg", color: "ffe65c00", icon: EARTH_ICONS.PIN, legend: "tap leg — blue" }),
  [EARTH_TYPES.PASS_THROUGH]: Object.freeze({ label: "pass-through", color: "ffffffff", icon: EARTH_ICONS.PIN, legend: "pass-through / MST only — white" }),
  [EARTH_TYPES.POLE]: Object.freeze({ label: "", color: "ff000000", icon: EARTH_ICONS.DOT, legend: "pole — black dot" }),
  [EARTH_TYPES.UNKNOWN]: Object.freeze({ label: "?", color: "ff888888", icon: EARTH_ICONS.PIN, legend: "unresolved — gray" }),
});

/** One legend entry per colour, in the order the splicer reads the sheet. */
export const EARTH_LEGEND_ORDER = Object.freeze([
  EARTH_TYPES.SPLITTER_1X8,
  EARTH_TYPES.SPLITTER_1X4,
  EARTH_TYPES.PCOT_TAP_1X2,
  EARTH_TYPES.PCOT_TAP_1X4,
  EARTH_TYPES.TAP_LEG_1X2,
  EARTH_TYPES.PASS_THROUGH,
  EARTH_TYPES.POLE,
]);

/** TDS attribute names this exporter reads. */
export const EARTH_TDS_FIELDS = Object.freeze({
  materialUnit: "Material Unit",
  deviceType: "Network Device Type",
  splitterOrder: "Splitter Order",
  splitterRatio: "Splitter Ratio",
  enclosureUnit: "Enclosure Unit",
});

/** The enclosure the design uses for a PCOT pass-through / MST-only location. */
export const PASS_THROUGH_ENCLOSURE_UNIT = "HAFO(PCOT)LO";

export function earthStyleFor(type){
  return EARTH_STYLE_TABLE[type] || EARTH_STYLE_TABLE[EARTH_TYPES.UNKNOWN];
}

/* ==========================================================================
   Field normalisation
   ========================================================================== */

const NULLISH = new Set(["", "<null>", "null", "n/a", "na", "none", "undefined"]);

/** TDS writes absent values as "<Null>"; treat those and N/A as absent. */
export function earthValue(raw){
  if (raw === null || raw === undefined) return null;
  const text = String(raw).replace(/\s+/g, " ").trim();
  return NULLISH.has(text.toLowerCase()) ? null : text;
}

function toNumberOrNull(raw){
  const text = earthValue(raw);
  if (text === null) return null;
  const num = Number(text);
  return Number.isFinite(num) ? num : null;
}

/** Leading integer of a device type field: "2", "Type 2" -> 2. */
function deviceTypeNumber(raw){
  const text = earthValue(raw);
  if (text === null) return null;
  const match = /(\d+)/.exec(text);
  return match ? Number(match[1]) : null;
}

/**
 * Separators the field uses between a pole number and its street address:
 *   "2015 · 103 Klamath Rd", "2015 - 103 Klamath Rd", "2015: 103 Klamath Rd"
 */
const POLE_LABEL_SPLIT = /^(\d{2,})\s*[·•\-–—:|,]\s*(\S.*)$/;

/**
 * Split a field label into its pole number and the rest.
 *
 * The staking sheets and the engineer's own Earth project name a location
 * "2015 · 103 Klamath Rd", so a name in that shape yields both halves. Anything
 * else yields no address — the remainder of a name is only treated as a street
 * address when the number/separator shape says so.
 */
export function splitPoleLabel(name){
  const text = String(name ?? "").trim();
  const match = POLE_LABEL_SPLIT.exec(text);
  if (!match) return { pole: poleNumberFromName(text), address: "" };
  return { pole: match[1], address: match[2].trim() };
}

/**
 * Pole number from a name.
 *   "RuidosoNetworkPoint-1654"  -> "1654"   trailing run
 *   "POLE 1748"                 -> "1748"   trailing run
 *   "2015 · 103 Klamath Rd"     -> "2015"   leads the label, address follows
 *   "MST-3 / East Pedestal"     -> "3"      the only run in the name
 *   "MST-3 near 1748 pole A"    -> ""       ambiguous, so not guessed at
 */
export function poleNumberFromName(name){
  const text = String(name ?? "").trim();
  if (!text) return "";
  const trailing = /(\d+)\s*$/.exec(text);
  if (trailing) return trailing[1];
  const leading = POLE_LABEL_SPLIT.exec(text);
  if (leading) return leading[1];
  const runs = text.match(/\d+/g) || [];
  return runs.length === 1 ? runs[0] : "";
}

/* ==========================================================================
   Type resolution
   ========================================================================== */

/**
 * Resolve one Network Device to a type, from its own TDS fields only.
 *
 * The Material Unit strings are self-describing part identities, so a device
 * carrying one resolves on that alone; Device Type 2 is recorded alongside PCOT
 * material units but exports that omit the column must not push a real tap into
 * UNKNOWN. The tap-leg rule has no material unit to lean on, so it requires the
 * full signature the engineer documented — Device Type 1, no Material Unit,
 * Splitter Order 3, and a Splitter Ratio of 2 or 4.
 *
 * @returns {string} an EARTH_TYPES value; UNKNOWN when nothing resolves.
 */
export function resolveDeviceType(device){
  if (!device) return EARTH_TYPES.UNKNOWN;
  const materialUnit = earthValue(device.materialUnit ?? device[EARTH_TDS_FIELDS.materialUnit]);
  const type = deviceTypeNumber(device.deviceType ?? device[EARTH_TDS_FIELDS.deviceType]);
  const order = toNumberOrNull(device.splitterOrder ?? device[EARTH_TDS_FIELDS.splitterOrder]);
  const ratio = toNumberOrNull(device.splitterRatio ?? device[EARTH_TDS_FIELDS.splitterRatio]);

  if (materialUnit){
    if (/^splitter\(1x8\)$/i.test(materialUnit)) return EARTH_TYPES.SPLITTER_1X8;
    if (/^splitter\(1x4\)$/i.test(materialUnit)) return EARTH_TYPES.SPLITTER_1X4;
    if (/^hxfo\(1x2\)pcot/i.test(materialUnit)) return EARTH_TYPES.PCOT_TAP_1X2;
    if (/^hxfo\(1x4\)pcot/i.test(materialUnit)) return EARTH_TYPES.PCOT_TAP_1X4;
    return EARTH_TYPES.UNKNOWN;
  }

  if (type === 1 && order === 3){
    if (ratio === 2) return EARTH_TYPES.TAP_LEG_1X2;
    if (ratio === 4) return EARTH_TYPES.TAP_LEG_1X4;
  }
  return EARTH_TYPES.UNKNOWN;
}

/** A splitter outranks a tap, a tap outranks a leg — that is what the pin should show. */
const TYPE_RANK = Object.freeze({
  [EARTH_TYPES.SPLITTER_1X8]: 6,
  [EARTH_TYPES.SPLITTER_1X4]: 5,
  [EARTH_TYPES.PCOT_TAP_1X4]: 4,
  [EARTH_TYPES.PCOT_TAP_1X2]: 3,
  [EARTH_TYPES.TAP_LEG_1X4]: 2,
  [EARTH_TYPES.TAP_LEG_1X2]: 1,
});

/**
 * Resolve a whole location (one pole) to the type its pin should carry.
 *
 * @param {object} location
 * @param {Array}  location.devices        Network Devices at this pole (may be empty).
 * @param {string} location.enclosureUnit  Enclosure Unit of the connectivity point, if known.
 * @param {boolean} location.hasEnclosure  Whether a connectivity point exists here at all.
 *                                         Undefined means "we were not told", which is not
 *                                         the same as "there is none".
 */
export function resolveLocationType(location){
  const devices = Array.isArray(location?.devices) ? location.devices : [];
  if (devices.length){
    const resolved = devices
      .map((device) => resolveDeviceType(device))
      .filter((type) => TYPE_RANK[type] !== undefined);
    if (!resolved.length) return EARTH_TYPES.UNKNOWN;
    return resolved.reduce((best, type) => (TYPE_RANK[type] > TYPE_RANK[best] ? type : best));
  }

  const enclosureUnit = earthValue(location?.enclosureUnit ?? location?.[EARTH_TDS_FIELDS.enclosureUnit]);
  if (enclosureUnit){
    // A PCOT enclosure with no device in it is the MST-only / pass-through case.
    return enclosureUnit.toUpperCase() === PASS_THROUGH_ENCLOSURE_UNIT.toUpperCase()
      ? EARTH_TYPES.PASS_THROUGH
      : EARTH_TYPES.UNKNOWN;
  }

  // No devices and no enclosure recorded. Known-empty is a plain pole; silence
  // from the dataset is not evidence of an empty pole, so it stays UNKNOWN.
  if (location?.hasEnclosure === false) return EARTH_TYPES.POLE;
  return EARTH_TYPES.UNKNOWN;
}

/* ==========================================================================
   Geometry
   ========================================================================== */

const EARTH_RADIUS_M = 6371008.8;
const FEET_PER_METER = 3.280839895013123;

export function distanceMeters(a, b){
  const toRad = (value) => (Number(value) * Math.PI) / 180;
  const lat1 = toRad(a?.lat), lat2 = toRad(b?.lat);
  const dLat = lat2 - lat1;
  const dLng = toRad(b?.lng) - toRad(a?.lng);
  if (!Number.isFinite(dLat) || !Number.isFinite(dLng)) return Number.POSITIVE_INFINITY;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function distanceFeet(a, b){
  return distanceMeters(a, b) * FEET_PER_METER;
}

function hasCoords(item){
  return Number.isFinite(Number(item?.lat)) && Number.isFinite(Number(item?.lng));
}

/**
 * Nearest reference poles around the target.
 *
 * Up to `limit` poles inside `radiusFeet`. When the radius holds fewer than
 * `minimum`, fall back to the nearest `minimum` regardless of distance, so a
 * sparse rural run still gives the splicer something to orient against.
 *
 * @returns {Array} the chosen poles, nearest first, each with `distanceFeet`.
 */
export function selectReferencePoles(target, candidates, {
  limit = 8,
  radiusFeet = 500,
  minimum = 4,
} = {}){
  if (!hasCoords(target)) return [];
  const targetPole = String(target.pole ?? "");
  const seen = new Set(targetPole ? [targetPole] : []);
  const ranked = [];
  for (const candidate of (Array.isArray(candidates) ? candidates : [])){
    if (!hasCoords(candidate)) continue;
    const pole = String(candidate.pole ?? "");
    if (!pole || seen.has(pole)) continue;
    seen.add(pole);
    ranked.push({ ...candidate, distanceFeet: distanceFeet(target, candidate) });
  }
  ranked.sort((a, b) => a.distanceFeet - b.distanceFeet);
  const inside = ranked.filter((item) => item.distanceFeet <= radiusFeet).slice(0, limit);
  return inside.length >= minimum ? inside : ranked.slice(0, minimum);
}

/* ==========================================================================
   KML
   ========================================================================== */

function escapeXml(value){
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;",
  })[character]);
}

/** CDATA cannot contain "]]>"; split the sequence rather than dropping content. */
function cdata(value){
  return `<![CDATA[${String(value ?? "").split("]]>").join("]]]]><![CDATA[>")}]]>`;
}

function coord(point){
  return `${Number(point.lng).toFixed(8)},${Number(point.lat).toFixed(8)},0`;
}

/**
 * Visible name for a pin — this is the text Google Earth draws as the label.
 *
 *   "2015 · 103 Klamath Rd"   pole with a street address in the dataset
 *   "1751 · 1x4 splitter"     no address, so the device identifies it instead
 *   "1752"                    a plain pole with neither
 *
 * The street address wins over the device label because that is what the
 * splicer navigates by, and the device is already carried by the pin colour and
 * spelled out in the balloon. An address is only ever shown when the dataset
 * supplied one; none is derived from a nearby record.
 */
export function placemarkName(pole, type, { withPolePrefix = false, address = "" } = {}){
  const head = withPolePrefix ? `Pole ${pole}` : String(pole);
  const tail = String(address || "").trim() || earthStyleFor(type).label;
  return tail ? `${head} · ${tail}` : head;
}

export function appLocationUrl({ origin = "https://telecomengine.app", projectSlug = "", pole = "" } = {}){
  const params = [];
  if (projectSlug) params.push(`project=${encodeURIComponent(projectSlug)}`);
  if (pole) params.push(`pole=${encodeURIComponent(pole)}`);
  return params.length ? `${origin}/?${params.join("&")}` : origin;
}

/** TE_<project>_Pole<####>.kmz — e.g. TE_ruidoso_Pole1748.kmz */
export function earthKmzFileName({ projectSlug = "", pole = "" } = {}){
  const slug = String(projectSlug || "project").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "project";
  const number = String(pole || "").replace(/[^\w]+/g, "") || "location";
  return `TE_${slug}_Pole${number}.kmz`;
}

function iconStyle(id, { icon, color, iconScale, labelScale }){
  const hotSpot = icon === EARTH_ICONS.PIN
    ? `<hotSpot x="32" y="1" xunits="pixels" yunits="pixels"/>`
    : `<hotSpot x="0.5" y="0.5" xunits="fraction" yunits="fraction"/>`;
  return `<Style id="${id}">`
    + `<IconStyle><color>${color}</color><scale>${iconScale}</scale>`
    + `<Icon><href>${escapeXml(icon)}</href></Icon>${hotSpot}</IconStyle>`
    + `<LabelStyle><scale>${labelScale}</scale></LabelStyle>`
    + `</Style>`;
}

const TARGET_STYLE_PREFIX = "te-target-";
const REF_STYLE_PREFIX = "te-ref-";
const LEGEND_STYLE_PREFIX = "te-legend-";
const PATH_STYLE_ID = "te-path";

function styleId(prefix, type){
  return `${prefix}${String(type).toLowerCase().replace(/_/g, "-")}`;
}

function buildStyles(){
  const out = [];
  for (const type of Object.keys(EARTH_STYLE_TABLE)){
    const style = earthStyleFor(type);
    // Large paddle for the location the splicer opened.
    out.push(iconStyle(styleId(TARGET_STYLE_PREFIX, type), {
      icon: style.icon, color: style.color, iconScale: 1.5, labelScale: 1.25,
    }));
    // Smaller pin for a neighbour, with the pole number sized to read on a phone.
    out.push(iconStyle(styleId(REF_STYLE_PREFIX, type), {
      icon: style.icon, color: style.color, iconScale: 0.85, labelScale: 1.1,
    }));
    out.push(iconStyle(styleId(LEGEND_STYLE_PREFIX, type), {
      icon: style.icon, color: style.color, iconScale: 1.1, labelScale: 1,
    }));
  }
  out.push(`<Style id="${PATH_STYLE_ID}"><LineStyle><color>ff888888</color><width>2</width></LineStyle></Style>`);
  return out.join("");
}

function summaryHtml(target, link){
  const rows = (Array.isArray(target?.summary) ? target.summary : [])
    .filter((row) => row && row.label)
    .map((row) => `<tr><td style="padding:2px 10px 2px 0;color:#555;">${escapeXml(row.label)}</td>`
      + `<td style="padding:2px 0;"><b>${escapeXml(row.value ?? "—")}</b></td></tr>`)
    .join("");
  const table = rows ? `<table style="border-collapse:collapse;font:13px sans-serif;">${rows}</table>` : "";
  const coords = `<div style="font:12px monospace;color:#666;margin-top:6px;">`
    + `${Number(target.lat).toFixed(6)}, ${Number(target.lng).toFixed(6)}</div>`;
  return `<div style="font:13px sans-serif;">${table}${coords}`
    + `<div style="margin-top:8px;"><a href="${escapeXml(link)}">Open this location in TelecomEngine</a></div></div>`;
}

/**
 * Build the context KML for one location.
 *
 * @param {object}   context
 * @param {object}   context.target          { pole, lat, lng, type, summary: [{label, value}] }
 * @param {Array}    context.references      neighbouring poles, already selected
 * @param {Array}    context.paths           [{ name, coordinates: [{lat,lng}, ...] }] — omitted when
 *                                           the dataset has no geometry; never synthesised
 * @param {string}   context.projectSlug     used for the app link back
 * @param {string}   context.appOrigin
 * @param {number}   context.lookAtRangeMeters
 * @returns {string} KML document text
 */
export function buildContextKml(context = {}){
  const {
    target,
    references = [],
    paths = [],
    projectSlug = "",
    appOrigin = "https://telecomengine.app",
    lookAtRangeMeters = 250,
  } = context;

  if (!target || !hasCoords(target)){
    throw new Error("A context KMZ needs a target location with coordinates.");
  }
  const pole = String(target.pole ?? "").trim();
  if (!pole) throw new Error("A context KMZ needs the target's pole number.");

  const targetType = target.type || EARTH_TYPES.UNKNOWN;
  const documentName = `TelecomEngine — Pole ${pole}`;
  const link = appLocationUrl({ origin: appOrigin, projectSlug, pole });

  const targetPlacemark = `<Placemark>`
    + `<name>${escapeXml(placemarkName(pole, targetType, { withPolePrefix: true, address: target.address }))}</name>`
    + `<styleUrl>#${styleId(TARGET_STYLE_PREFIX, targetType)}</styleUrl>`
    + `<description>${cdata(summaryHtml(target, link))}</description>`
    + `<Point><coordinates>${coord(target)}</coordinates></Point>`
    + `</Placemark>`;

  const referencePlacemarks = references
    .filter(hasCoords)
    .map((reference) => {
      const type = reference.type || EARTH_TYPES.POLE;
      const referencePole = String(reference.pole ?? "").trim();
      const distance = Number.isFinite(reference.distanceFeet)
        ? `<description>${cdata(`${Math.round(reference.distanceFeet)} ft from Pole ${escapeXml(pole)}`)}</description>`
        : "";
      return `<Placemark>`
        + `<name>${escapeXml(placemarkName(referencePole, type, { address: reference.address }))}</name>`
        + `<styleUrl>#${styleId(REF_STYLE_PREFIX, type)}</styleUrl>`
        + distance
        + `<Point><coordinates>${coord(reference)}</coordinates></Point>`
        + `</Placemark>`;
    })
    .join("");

  // Only real geometry is drawn. A run with no path record in the dataset gets
  // no line at all rather than a straight guess between two pins.
  const pathPlacemarks = (Array.isArray(paths) ? paths : [])
    .map((path) => ({
      name: path?.name || "Cable path",
      points: (Array.isArray(path?.coordinates) ? path.coordinates : []).filter(hasCoords),
    }))
    .filter((path) => path.points.length >= 2)
    .map((path) => `<Placemark>`
      + `<name>${escapeXml(path.name)}</name>`
      + `<styleUrl>#${PATH_STYLE_ID}</styleUrl>`
      + `<LineString><tessellate>1</tessellate>`
      + `<coordinates>${path.points.map(coord).join(" ")}</coordinates>`
      + `</LineString></Placemark>`)
    .join("");

  // Sidebar-only key. visibility 0 keeps seven extra pins off the target's coords.
  const legendPlacemarks = EARTH_LEGEND_ORDER.map((type) => `<Placemark>`
    + `<name>${escapeXml(earthStyleFor(type).legend)}</name>`
    + `<visibility>0</visibility>`
    + `<styleUrl>#${styleId(LEGEND_STYLE_PREFIX, type)}</styleUrl>`
    + `<Point><coordinates>${coord(target)}</coordinates></Point>`
    + `</Placemark>`).join("");

  const folders = [
    `<Folder><name>Target</name><open>1</open>${targetPlacemark}</Folder>`,
    referencePlacemarks
      ? `<Folder><name>Reference Poles</name><open>1</open>${referencePlacemarks}</Folder>`
      : "",
    pathPlacemarks ? `<Folder><name>Paths</name>${pathPlacemarks}</Folder>` : "",
    `<Folder><name>Legend</name><visibility>0</visibility><open>0</open>${legendPlacemarks}</Folder>`,
  ].filter(Boolean).join("");

  return `<?xml version="1.0" encoding="UTF-8"?>\n`
    + `<kml xmlns="http://www.opengis.net/kml/2.2">`
    + `<Document>`
    + `<name>${escapeXml(documentName)}</name>`
    + `<open>1</open>`
    + `<LookAt>`
    + `<longitude>${Number(target.lng).toFixed(8)}</longitude>`
    + `<latitude>${Number(target.lat).toFixed(8)}</latitude>`
    + `<altitude>0</altitude><heading>0</heading><tilt>0</tilt>`
    + `<range>${Number(lookAtRangeMeters)}</range>`
    + `<altitudeMode>relativeToGround</altitudeMode>`
    + `</LookAt>`
    + buildStyles()
    + folders
    + `</Document></kml>`;
}

/** Folder order for the whole-project layer: the loudest hardware first. */
const PROJECT_FOLDER_ORDER = Object.freeze([
  EARTH_TYPES.SPLITTER_1X8,
  EARTH_TYPES.SPLITTER_1X4,
  EARTH_TYPES.PCOT_TAP_1X4,
  EARTH_TYPES.PCOT_TAP_1X2,
  EARTH_TYPES.TAP_LEG_1X4,
  EARTH_TYPES.TAP_LEG_1X2,
  EARTH_TYPES.PASS_THROUGH,
  EARTH_TYPES.POLE,
  EARTH_TYPES.UNKNOWN,
]);

/** Folder titles for the whole-project layer. */
const PROJECT_FOLDER_NAMES = Object.freeze({
  [EARTH_TYPES.SPLITTER_1X8]: "1x8 splitters",
  [EARTH_TYPES.SPLITTER_1X4]: "1x4 splitters",
  [EARTH_TYPES.PCOT_TAP_1X4]: "1x4 PCOT taps",
  [EARTH_TYPES.PCOT_TAP_1X2]: "1x2 PCOT taps",
  [EARTH_TYPES.TAP_LEG_1X4]: "1x4 tap legs",
  [EARTH_TYPES.TAP_LEG_1X2]: "1x2 tap legs",
  [EARTH_TYPES.PASS_THROUGH]: "Pass-through / MST only",
  [EARTH_TYPES.POLE]: "Poles",
  [EARTH_TYPES.UNKNOWN]: "Unresolved",
});

/** Centre and a framing range for a set of poles. */
function fitLookAt(poles){
  const lats = poles.map((pole) => Number(pole.lat));
  const lngs = poles.map((pole) => Number(pole.lng));
  const south = Math.min(...lats), north = Math.max(...lats);
  const west = Math.min(...lngs), east = Math.max(...lngs);
  const centre = { lat: (south + north) / 2, lng: (west + east) / 2 };
  const diagonal = distanceMeters({ lat: south, lng: west }, { lat: north, lng: east });
  // Enough range to hold the whole run, with a floor so a one-pole project is
  // not framed from the ground.
  return { ...centre, range: Math.max(400, Math.round(diagonal * 1.3)) };
}

/**
 * Build the whole-project pole layer: every pole the dataset places, each
 * labelled with its number, coloured by what the design puts on it.
 *
 * Loaded once and left on, this is what puts a number beside every pole in
 * Google Earth wherever the splicer happens to be standing, instead of a file
 * that re-centres on one location. Poles are grouped into a folder per device
 * type so a crowded run can be thinned from the Earth sidebar.
 *
 * @param {object} context
 * @param {Array}  context.poles  [{ pole, lat, lng, type, address, enclosureUnit, devices }]
 * @returns {string} KML document text
 */
export function buildProjectKml(context = {}){
  const {
    poles = [],
    projectName = "",
    projectSlug = "",
    appOrigin = "https://telecomengine.app",
    paths = [],
  } = context;

  const placed = (Array.isArray(poles) ? poles : []).filter(hasCoords).filter((pole) => String(pole.pole ?? "").trim());
  if (!placed.length) throw new Error("No pole in this project has coordinates to export.");

  const documentName = projectName
    ? `TelecomEngine — ${projectName} poles`
    : "TelecomEngine — project poles";
  const view = fitLookAt(placed);

  const byType = new Map();
  for (const pole of placed){
    const type = pole.type || EARTH_TYPES.UNKNOWN;
    if (!byType.has(type)) byType.set(type, []);
    byType.get(type).push(pole);
  }

  const folders = PROJECT_FOLDER_ORDER
    .filter((type) => byType.has(type))
    .map((type) => {
      const group = byType.get(type).slice().sort((a, b) => String(a.pole).localeCompare(String(b.pole), "en", { numeric: true }));
      const placemarks = group.map((pole) => {
        const rows = [
          { label: "Pole", value: pole.pole },
          { label: "Type", value: earthStyleFor(type).label || "pole" },
          pole.address ? { label: "Address", value: pole.address } : null,
          pole.enclosureUnit ? { label: "Enclosure unit", value: pole.enclosureUnit } : null,
        ].filter(Boolean);
        const link = appLocationUrl({ origin: appOrigin, projectSlug, pole: pole.pole });
        return `<Placemark>`
          + `<name>${escapeXml(placemarkName(pole.pole, type, { address: pole.address }))}</name>`
          + `<styleUrl>#${styleId(REF_STYLE_PREFIX, type)}</styleUrl>`
          + `<description>${cdata(summaryHtml({ ...pole, summary: rows }, link))}</description>`
          + `<Point><coordinates>${coord(pole)}</coordinates></Point>`
          + `</Placemark>`;
      }).join("");
      return `<Folder><name>${escapeXml(PROJECT_FOLDER_NAMES[type] || "Poles")} (${group.length})</name><open>0</open>${placemarks}</Folder>`;
    })
    .join("");

  const pathPlacemarks = (Array.isArray(paths) ? paths : [])
    .map((path) => ({
      name: path?.name || "Cable path",
      points: (Array.isArray(path?.coordinates) ? path.coordinates : []).filter(hasCoords),
    }))
    .filter((path) => path.points.length >= 2)
    .map((path) => `<Placemark>`
      + `<name>${escapeXml(path.name)}</name>`
      + `<styleUrl>#${PATH_STYLE_ID}</styleUrl>`
      + `<LineString><tessellate>1</tessellate>`
      + `<coordinates>${path.points.map(coord).join(" ")}</coordinates>`
      + `</LineString></Placemark>`)
    .join("");

  const legendPlacemarks = EARTH_LEGEND_ORDER.map((type) => `<Placemark>`
    + `<name>${escapeXml(earthStyleFor(type).legend)}</name>`
    + `<visibility>0</visibility>`
    + `<styleUrl>#${styleId(LEGEND_STYLE_PREFIX, type)}</styleUrl>`
    + `<Point><coordinates>${coord(view)}</coordinates></Point>`
    + `</Placemark>`).join("");

  return `<?xml version="1.0" encoding="UTF-8"?>\n`
    + `<kml xmlns="http://www.opengis.net/kml/2.2">`
    + `<Document>`
    + `<name>${escapeXml(documentName)}</name>`
    + `<open>1</open>`
    + `<LookAt>`
    + `<longitude>${view.lng.toFixed(8)}</longitude>`
    + `<latitude>${view.lat.toFixed(8)}</latitude>`
    + `<altitude>0</altitude><heading>0</heading><tilt>0</tilt>`
    + `<range>${view.range}</range>`
    + `<altitudeMode>relativeToGround</altitudeMode>`
    + `</LookAt>`
    + buildStyles()
    + folders
    + (pathPlacemarks ? `<Folder><name>Paths</name><open>0</open>${pathPlacemarks}</Folder>` : "")
    + `<Folder><name>Legend</name><visibility>0</visibility><open>0</open>${legendPlacemarks}</Folder>`
    + `</Document></kml>`;
}

/** TE_<project>_AllPoles.kmz */
export function earthProjectKmzFileName({ projectSlug = "" } = {}){
  const slug = String(projectSlug || "project").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "project";
  return `TE_${slug}_AllPoles.kmz`;
}

/**
 * Zip a KML document into a .kmz.
 *
 * `loadZip` supplies the JSZip constructor (the app already loads it for its
 * other KMZ work); keeping it injected leaves this module dependency-free.
 */
export async function zipKmlToKmz(kml, { loadZip, type = "blob" } = {}){
  if (typeof loadZip !== "function") throw new Error("zipKmlToKmz needs a loadZip factory.");
  const JSZip = await loadZip();
  const zip = new JSZip();
  zip.file("doc.kml", kml);
  const blob = await zip.generateAsync({
    type,
    mimeType: "application/vnd.google-earth.kmz",
    compression: "DEFLATE",
  });
  return { blob, kml };
}

export async function buildContextKmz(context, options = {}){
  return await zipKmlToKmz(buildContextKml(context), options);
}

/** The whole-project pole layer, packaged the same way. */
export async function buildProjectKmz(context, options = {}){
  return await zipKmlToKmz(buildProjectKml(context), options);
}
