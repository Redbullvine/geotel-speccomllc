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
 * Pole number from a name.
 *   "RuidosoNetworkPoint-1654" -> "1654"
 *   "POLE 1748"                -> "1748"
 * A name with several digit runs and no trailing run is not guessed at; it
 * resolves only when exactly one run exists.
 */
export function poleNumberFromName(name){
  const text = String(name ?? "").trim();
  if (!text) return "";
  const trailing = /(\d+)\s*$/.exec(text);
  if (trailing) return trailing[1];
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

/** Visible name for a pin: "Pole 1748 · 1x4 splitter"; plain poles show the number alone. */
export function placemarkName(pole, type, { withPolePrefix = false } = {}){
  const label = earthStyleFor(type).label;
  const head = withPolePrefix ? `Pole ${pole}` : String(pole);
  return label ? `${head} · ${label}` : head;
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
    + `<name>${escapeXml(placemarkName(pole, targetType, { withPolePrefix: true }))}</name>`
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
        + `<name>${escapeXml(placemarkName(referencePole, type))}</name>`
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

/**
 * Zip the KML into a .kmz.
 *
 * `loadZip` supplies the JSZip constructor (the app already loads it for its
 * other KMZ work); keeping it injected leaves this module dependency-free.
 */
export async function buildContextKmz(context, { loadZip, type = "blob" } = {}){
  if (typeof loadZip !== "function") throw new Error("buildContextKmz needs a loadZip factory.");
  const kml = buildContextKml(context);
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
