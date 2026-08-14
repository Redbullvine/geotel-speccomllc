export const MAX_SESSION_MINUTES = 24 * 60;
export const SPECCOM_TIME_ZONE = "America/Chicago";

export const REPORT_TIME_STATUS = Object.freeze({
  VALID: "valid",
  ACTIVE: "active",
  MISSING_START: "missing_start",
  MISSING_END: "missing_end",
  INVALID_START: "invalid_start",
  INVALID_END: "invalid_end",
  END_NOT_AFTER_START: "end_not_after_start",
  OVER_24_HOURS: "over_24_hours",
});

export const REPORT_TIME_LABELS = Object.freeze({
  [REPORT_TIME_STATUS.VALID]: "Completed",
  [REPORT_TIME_STATUS.ACTIVE]: "Active",
  [REPORT_TIME_STATUS.MISSING_START]: "Missing Start Time",
  [REPORT_TIME_STATUS.MISSING_END]: "Missing End Time",
  [REPORT_TIME_STATUS.INVALID_START]: "Invalid Start Time",
  [REPORT_TIME_STATUS.INVALID_END]: "Invalid End Time",
  [REPORT_TIME_STATUS.END_NOT_AFTER_START]: "End Time Must Be After Start",
  [REPORT_TIME_STATUS.OVER_24_HOURS]: "Invalid Duration (Over 24 Hours)",
});

export function getSpecComDateKey(value = new Date()){
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: SPECCOM_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function getTimeZoneOffsetMs(date){
  const value = new Intl.DateTimeFormat("en-US", {
    timeZone: SPECCOM_TIME_ZONE,
    timeZoneName: "longOffset",
  }).formatToParts(date).find((part) => part.type === "timeZoneName")?.value || "GMT";
  const match = value.match(/^GMT(?:(?<sign>[+-])(?<hours>\d{2}):(?<minutes>\d{2}))?$/);
  if (!match?.groups?.sign) return 0;
  const direction = match.groups.sign === "+" ? 1 : -1;
  return direction * ((Number(match.groups.hours) * 60) + Number(match.groups.minutes)) * 60000;
}

function zonedMidnightMs(dateKey){
  const match = String(dateKey || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return NaN;
  const utcMidnight = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  let candidate = utcMidnight - getTimeZoneOffsetMs(new Date(utcMidnight));
  candidate = utcMidnight - getTimeZoneOffsetMs(new Date(candidate));
  return candidate;
}

export function getSpecComDayBounds(dateKey){
  const startMs = zonedMidnightMs(dateKey);
  if (!Number.isFinite(startMs)) return { start: "", endExclusive: "" };
  const nextDate = new Date(Date.UTC(
    Number(String(dateKey).slice(0, 4)),
    Number(String(dateKey).slice(5, 7)) - 1,
    Number(String(dateKey).slice(8, 10)) + 1,
  ));
  const nextKey = `${nextDate.getUTCFullYear()}-${String(nextDate.getUTCMonth() + 1).padStart(2, "0")}-${String(nextDate.getUTCDate()).padStart(2, "0")}`;
  const endMs = zonedMidnightMs(nextKey);
  return { start: new Date(startMs).toISOString(), endExclusive: new Date(endMs).toISOString() };
}

export function getDateKeysInRange(dateFrom, dateTo, maxDays = 93){
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateFrom || "") || !/^\d{4}-\d{2}-\d{2}$/.test(dateTo || "") || dateFrom > dateTo) return [];
  const dates = [];
  const cursor = new Date(`${dateFrom}T12:00:00Z`);
  const end = new Date(`${dateTo}T12:00:00Z`);
  while (cursor <= end && dates.length < maxDays){
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function invalidResult(status){
  return {
    status,
    label: REPORT_TIME_LABELS[status],
    minutes: 0,
    included: false,
    active: false,
    startMs: null,
    endMs: null,
  };
}

/**
 * Calculates a report-safe duration directly from timestamps. Persisted duration
 * columns are intentionally ignored so corrupt or stale totals cannot bypass validation.
 */
export function assessReportDuration({ startedAt, endedAt, workDate, now = new Date() } = {}){
  if (startedAt == null || String(startedAt).trim() === "") return invalidResult(REPORT_TIME_STATUS.MISSING_START);
  const startMs = Date.parse(startedAt);
  if (!Number.isFinite(startMs)) return invalidResult(REPORT_TIME_STATUS.INVALID_START);

  const nowDate = now instanceof Date ? now : new Date(now);
  const nowMs = nowDate.getTime();
  const effectiveWorkDate = String(workDate || getSpecComDateKey(startedAt)).slice(0, 10);
  const isToday = Number.isFinite(nowMs) && effectiveWorkDate === getSpecComDateKey(nowDate);

  if (endedAt == null || String(endedAt).trim() === ""){
    if (!isToday) return invalidResult(REPORT_TIME_STATUS.MISSING_END);
    if (nowMs <= startMs) return invalidResult(REPORT_TIME_STATUS.END_NOT_AFTER_START);
    const activeMinutes = Math.round((nowMs - startMs) / 60000);
    if (activeMinutes > MAX_SESSION_MINUTES) return invalidResult(REPORT_TIME_STATUS.OVER_24_HOURS);
    return {
      status: REPORT_TIME_STATUS.ACTIVE,
      label: REPORT_TIME_LABELS[REPORT_TIME_STATUS.ACTIVE],
      minutes: activeMinutes,
      included: true,
      active: true,
      startMs,
      endMs: nowMs,
    };
  }

  const endMs = Date.parse(endedAt);
  if (!Number.isFinite(endMs)) return invalidResult(REPORT_TIME_STATUS.INVALID_END);
  if (endMs <= startMs) return invalidResult(REPORT_TIME_STATUS.END_NOT_AFTER_START);
  const minutes = Math.round((endMs - startMs) / 60000);
  if (minutes > MAX_SESSION_MINUTES) return invalidResult(REPORT_TIME_STATUS.OVER_24_HOURS);
  return {
    status: REPORT_TIME_STATUS.VALID,
    label: REPORT_TIME_LABELS[REPORT_TIME_STATUS.VALID],
    minutes,
    included: true,
    active: false,
    startMs,
    endMs,
  };
}

function mergeIntervals(intervals){
  const sorted = intervals
    .filter(([start, end]) => Number.isFinite(start) && Number.isFinite(end) && end > start)
    .sort((a, b) => a[0] - b[0]);
  const merged = [];
  sorted.forEach(([start, end]) => {
    const last = merged[merged.length - 1];
    if (!last || start > last[1]) merged.push([start, end]);
    else last[1] = Math.max(last[1], end);
  });
  return merged;
}

function totalMs(intervals){
  return intervals.reduce((sum, [start, end]) => sum + (end - start), 0);
}

function intersectIntervals(left, right){
  const intersections = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length){
    const start = Math.max(left[i][0], right[j][0]);
    const end = Math.min(left[i][1], right[j][1]);
    if (end > start) intersections.push([start, end]);
    if (left[i][1] <= right[j][1]) i += 1;
    else j += 1;
  }
  return intersections;
}

export function makeReportTimeWarning(row, assessment, source = "session"){
  if (assessment.included) return null;
  return {
    source,
    id: row?.id || "",
    workDate: row?.work_date || getSpecComDateKey(row?.started_at || row?.clock_in_at),
    startedAt: row?.started_at || row?.clock_in_at || "",
    endedAt: row?.ended_at || row?.clock_out_at || "",
    status: assessment.status,
    label: assessment.label,
  };
}

/**
 * Computes authoritative worked time for one employee. Project Day intervals are
 * unioned, then completed break/lunch intervals are unioned and subtracted once.
 * Inspection/location spans remain detail-only and never add worked minutes.
 */
export function calculateWorkedTime(sessions = [], events = [], {
  now = new Date(),
  workDate = "",
  startKey = "started_at",
  endKey = "ended_at",
  breakTypes = ["BREAK_15", "LUNCH"],
  source = "Project Day",
} = {}){
  const sessionAssessments = sessions.map((row) => ({
    row,
    assessment: assessReportDuration({
      startedAt: row?.[startKey],
      endedAt: row?.[endKey],
      workDate: row?.work_date || workDate,
      now,
    }),
  }));
  const validSessionIntervals = mergeIntervals(sessionAssessments
    .filter(({ assessment }) => assessment.included)
    .map(({ assessment }) => [assessment.startMs, assessment.endMs]));

  const eventAssessments = events.map((row) => ({
    row,
    assessment: assessReportDuration({
      startedAt: row?.started_at,
      endedAt: row?.ended_at,
      workDate: row?.work_date || workDate,
      now,
    }),
  }));
  const breakSet = new Set(breakTypes);
  const completedBreakIntervals = mergeIntervals(eventAssessments
    .filter(({ row, assessment }) => breakSet.has(row?.event_type)
      && assessment.status === REPORT_TIME_STATUS.VALID)
    .map(({ assessment }) => [assessment.startMs, assessment.endMs]));
  const appliedBreakIntervals = intersectIntervals(validSessionIntervals, completedBreakIntervals);
  const grossMs = totalMs(validSessionIntervals);
  const breakMs = totalMs(appliedBreakIntervals);
  const warnings = sessionAssessments
    .map(({ row, assessment }) => makeReportTimeWarning(row, assessment, source))
    .filter(Boolean)
    .concat(eventAssessments
      .map(({ row, assessment }) => makeReportTimeWarning(row, assessment, "Event"))
      .filter(Boolean));

  return {
    minutes: Math.max(0, Math.round((grossMs - breakMs) / 60000)),
    grossMinutes: Math.round(grossMs / 60000),
    breakMinutes: Math.round(breakMs / 60000),
    sessionAssessments,
    eventAssessments,
    warnings,
  };
}
