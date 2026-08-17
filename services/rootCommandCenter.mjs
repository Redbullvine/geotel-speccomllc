export const ROOT_XRAY_LEVEL = Object.freeze({
  CRITICAL: "critical",
  ATTENTION: "attention",
  REVIEW: "review",
  CLEAR: "clear",
});

export const ROOT_EXCEPTION_LABELS = Object.freeze({
  needs_return: "Needs Return",
  escalated: "Escalated",
  weak_test: "Optical concern",
  missing_test: "Missing test",
  missing_gps: "Missing GPS",
  visited_no_closeout: "Visited without closeout",
  closeout_missing_photo: "Closeout missing photo",
  notes_no_closeout: "Notes without closeout",
  billing_overage: "Billed units exceed allowed",
  duplicate_location: "Possible duplicate location",
  location_mismatch: "Visit/location GPS mismatch",
  open_redline: "Open Redline",
});

const SEVERITY_RANK = Object.freeze({ critical: 4, attention: 3, review: 2, clear: 1 });

function numberOrNull(value){
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function normalizeLocationIdentity(value){
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function getCloseoutFinalStatus(closeout){
  return String(closeout?.checklist?.final_status || closeout?.checklist?.finalStatus || "").trim();
}

export function isCompletedCloseout(closeout){
  return ["fixed", "audit complete", "complete", "completed"].includes(getCloseoutFinalStatus(closeout).toLowerCase());
}

function makeIssue(site, type, severity, why, evidence, extra = {}){
  return {
    id: `${String(site?.id || "site")}:${type}`,
    siteId: String(site?.id || ""),
    location: String(site?.name || "Unnamed location"),
    type,
    label: ROOT_EXCEPTION_LABELS[type] || type,
    severity,
    why,
    evidence,
    ...extra,
  };
}

function indexRows(rows, key = "site_id"){
  const map = new Map();
  for (const row of rows || []){
    const id = String(row?.[key] || "");
    if (!id) continue;
    if (!map.has(id)) map.set(id, []);
    map.get(id).push(row);
  }
  return map;
}

export function analyzeRootProject({
  project = null,
  sites = [],
  media = [],
  codes = [],
  workLogs = [],
  closeouts = [],
  redlines = [],
  opticalConcernThresholdDbm = -25,
  gpsMismatchMeters = 150,
} = {}){
  const mediaBySite = indexRows(media);
  const codesBySite = indexRows(codes);
  const logsBySite = indexRows(workLogs);
  const closeoutsBySite = indexRows(closeouts, "base_location_id");
  const redlinesBySite = indexRows(redlines);
  const duplicateGroups = new Map();
  for (const site of sites){
    const key = normalizeLocationIdentity(site?.name);
    if (!key) continue;
    if (!duplicateGroups.has(key)) duplicateGroups.set(key, []);
    duplicateGroups.get(key).push(site);
  }

  const issues = [];
  const records = (sites || []).map((site) => {
    const siteId = String(site?.id || "");
    const siteMedia = mediaBySite.get(siteId) || [];
    const siteCodes = codesBySite.get(siteId) || [];
    const siteLogs = (logsBySite.get(siteId) || []).slice().sort((a, b) => Date.parse(b.completed_at || b.created_at || 0) - Date.parse(a.completed_at || a.created_at || 0));
    const siteCloseouts = (closeoutsBySite.get(siteId) || []).slice().sort((a, b) => Date.parse(b.submitted_at || b.created_at || 0) - Date.parse(a.submitted_at || a.created_at || 0));
    const siteRedlines = redlinesBySite.get(siteId) || [];
    const latestCloseout = siteCloseouts[0] || null;
    const finalStatus = getCloseoutFinalStatus(latestCloseout);
    const closeoutPhotoCount = Math.max(0, numberOrNull(latestCloseout?.checklist?.photo_count) || 0);
    const hasPhotoEvidence = siteMedia.length > 0 || closeoutPhotoCount > 0 || Boolean(latestCloseout?.checklist?.no_photo_possible);
    const readings = [numberOrNull(site?.test_result_low), numberOrNull(site?.test_result_high)].filter((value) => value !== null);
    const worstReading = readings.length ? Math.min(...readings) : null;
    const hasGps = numberOrNull(site?.gps_lat ?? site?.lat) !== null && numberOrNull(site?.gps_lng ?? site?.lng) !== null;
    const completed = isCompletedCloseout(latestCloseout) || String(siteLogs[0]?.status_after || "").toUpperCase() === "COMPLETE";
    const needsReturn = finalStatus.toLowerCase() === "needs return";
    const escalated = finalStatus.toLowerCase() === "escalate";
    const localIssues = [];
    const add = (type, severity, why, evidence, extra) => {
      const issue = makeIssue(site, type, severity, why, evidence, extra);
      issues.push(issue);
      localIssues.push(issue);
    };

    if (!hasGps) add("missing_gps", ROOT_XRAY_LEVEL.ATTENTION, "The location cannot be reliably navigated to or checked against field evidence.", "No usable site latitude/longitude is stored.");
    if (!readings.length) add("missing_test", ROOT_XRAY_LEVEL.REVIEW, "Optical condition cannot be evaluated from the project record.", "Both imported test fields are blank.");
    if (worstReading !== null && worstReading < opticalConcernThresholdDbm){
      add("weak_test", ROOT_XRAY_LEVEL.CRITICAL, "At least one stored optical value is below the application revisit threshold. LOW/HIGH meaning remains undefined.", `Worst stored value ${worstReading.toFixed(2)} dBm; derived threshold ${opticalConcernThresholdDbm} dBm.`, { value: worstReading });
    }
    if (needsReturn) add("needs_return", ROOT_XRAY_LEVEL.CRITICAL, "The latest field closeout explicitly requires another visit.", `Latest final status: ${finalStatus}.`);
    if (escalated) add("escalated", ROOT_XRAY_LEVEL.CRITICAL, "The latest field closeout explicitly escalated this location.", `Latest final status: ${finalStatus}.`);
    if (siteLogs.length && !siteCloseouts.length) add("visited_no_closeout", ROOT_XRAY_LEVEL.ATTENTION, "Work activity exists but no structured closeout record was found.", `${siteLogs.length} field work log${siteLogs.length === 1 ? "" : "s"}; zero closeouts.`);
    if (completed && !hasPhotoEvidence){
      add("closeout_missing_photo", ROOT_XRAY_LEVEL.ATTENTION, "The location appears complete but has no recorded photo evidence.", "Completion evidence exists; site_media count and closeout photo_count are both zero.");
    }
    if (String(site?.notes || "").trim() && !siteCloseouts.length){
      add("notes_no_closeout", ROOT_XRAY_LEVEL.REVIEW, "Notes exist without a structured closeout. Imported/design notes may be legitimate, so this requires review rather than automatic correction.", "Site notes are populated; closeout count is zero.");
    }
    const allowed = numberOrNull(site?.units_allowed);
    const billed = numberOrNull(site?.units_billed);
    if (allowed !== null && billed !== null && billed > allowed){
      add("billing_overage", ROOT_XRAY_LEVEL.ATTENTION, "Billed production exceeds the units allowed on the site record.", `${billed} billed / ${allowed} allowed.`);
    }
    const duplicateKey = normalizeLocationIdentity(site?.name);
    const duplicates = duplicateKey ? duplicateGroups.get(duplicateKey) || [] : [];
    if (duplicates.length > 1){
      add("duplicate_location", ROOT_XRAY_LEVEL.ATTENTION, "Multiple active-project site records normalize to the same location name.", `${duplicates.length} records match “${site?.name || "Unnamed"}”.`);
    }
    const mismatchedLog = siteLogs.find((row) => numberOrNull(row?.nearest_distance_m) !== null && Number(row.nearest_distance_m) > gpsMismatchMeters);
    if (mismatchedLog){
      add("location_mismatch", ROOT_XRAY_LEVEL.ATTENTION, "A field log was associated from unusually far away and should be verified.", `Recorded nearest distance ${Math.round(Number(mismatchedLog.nearest_distance_m))} m; review threshold ${gpsMismatchMeters} m.`);
    }
    const openRedlines = siteRedlines.filter((row) => !["resolved", "closed", "complete", "completed"].includes(String(row?.status || "").trim().toLowerCase()));
    if (openRedlines.length) add("open_redline", ROOT_XRAY_LEVEL.ATTENTION, "An unresolved Redline is linked to this location.", `${openRedlines.length} open Redline record${openRedlines.length === 1 ? "" : "s"}.`);

    const level = localIssues.reduce((best, issue) => SEVERITY_RANK[issue.severity] > SEVERITY_RANK[best] ? issue.severity : best, ROOT_XRAY_LEVEL.CLEAR);
    const lastActivity = [site?.created_at, siteLogs[0]?.completed_at, latestCloseout?.submitted_at, siteMedia[0]?.created_at]
      .filter(Boolean).sort((a, b) => Date.parse(b) - Date.parse(a))[0] || "";
    return {
      site,
      siteId,
      media: siteMedia,
      codes: siteCodes,
      workLogs: siteLogs,
      closeouts: siteCloseouts,
      redlines: siteRedlines,
      latestCloseout,
      finalStatus,
      completed,
      needsReturn,
      escalated,
      hasGps,
      hasPhotoEvidence,
      worstReading,
      level,
      issues: localIssues,
      lastActivity,
    };
  });

  const metrics = {
    total: records.length,
    completed: records.filter((record) => record.completed).length,
    needsReturn: records.filter((record) => record.needsReturn).length,
    escalated: records.filter((record) => record.escalated).length,
    untested: records.filter((record) => record.worstReading === null).length,
    opticalConcern: records.filter((record) => record.worstReading !== null && record.worstReading < opticalConcernThresholdDbm).length,
    missingGps: records.filter((record) => !record.hasGps).length,
    missingPhotosAfterWork: records.filter((record) => (record.workLogs.length || record.closeouts.length) && !record.hasPhotoEvidence).length,
    visitedNoCloseout: records.filter((record) => record.workLogs.length && !record.closeouts.length).length,
    notesNoCloseout: records.filter((record) => String(record.site?.notes || "").trim() && !record.closeouts.length).length,
    openRedlines: issues.filter((issue) => issue.type === "open_redline").length,
  };
  metrics.progressPercent = metrics.total ? Math.round((metrics.completed / metrics.total) * 100) : 0;
  return { project, records, issues, metrics, opticalConcernThresholdDbm };
}

export function searchRootProject(analysis, term){
  const needle = String(term || "").trim().toLowerCase();
  if (!needle) return analysis?.records || [];
  return (analysis?.records || []).filter((record) => {
    const searchable = [
      record.site?.name,
      record.site?.notes,
      record.site?.address,
      record.finalStatus,
      ...record.codes.map((row) => row?.code),
      ...record.issues.flatMap((issue) => [issue.label, issue.evidence]),
      ...record.redlines.flatMap((row) => [row?.node_name, row?.attached_node_id, row?.change_type, row?.notes]),
    ].filter(Boolean).join(" ").toLowerCase();
    return searchable.includes(needle);
  });
}

export function buildRootFieldBrief(analysis){
  const metrics = analysis?.metrics || {};
  const critical = (analysis?.issues || []).filter((issue) => issue.severity === ROOT_XRAY_LEVEL.CRITICAL);
  const attention = (analysis?.issues || []).filter((issue) => issue.severity === ROOT_XRAY_LEVEL.ATTENTION);
  const priorityLocations = [...new Set([...critical, ...attention].map((issue) => issue.location))].slice(0, 8);
  return {
    headline: `${metrics.completed || 0} of ${metrics.total || 0} locations currently have completion evidence (${metrics.progressPercent || 0}%).`,
    lines: [
      `${metrics.needsReturn || 0} Needs Return; ${metrics.escalated || 0} escalated.`,
      `${metrics.opticalConcern || 0} optical concern${metrics.opticalConcern === 1 ? "" : "s"} using the existing derived revisit threshold; ${metrics.untested || 0} untested.`,
      `${metrics.missingPhotosAfterWork || 0} worked/closed locations lack recorded photo evidence; ${metrics.visitedNoCloseout || 0} visits lack a structured closeout.`,
      `${metrics.missingGps || 0} locations lack usable GPS; ${metrics.openRedlines || 0} unresolved linked Redlines.`,
    ],
    priorityLocations,
  };
}
