import test from "node:test";
import assert from "node:assert/strict";
import {
  assessReportDuration,
  calculateWorkedTime,
  getSpecComDateKey,
  getSpecComDayBounds,
  getDateKeysInRange,
  REPORT_TIME_STATUS,
} from "../services/dailyReportTime.mjs";

const NOW = new Date("2026-07-21T18:00:00-05:00");

test("SpecCom dates and day boundaries use America/Chicago", () => {
  assert.equal(getSpecComDateKey("2026-07-22T02:00:00Z"), "2026-07-21");
  assert.deepEqual(getSpecComDayBounds("2026-07-14"), {
    start: "2026-07-14T05:00:00.000Z",
    endExclusive: "2026-07-15T05:00:00.000Z",
  });
  assert.deepEqual(getSpecComDayBounds("2026-12-14"), {
    start: "2026-12-14T06:00:00.000Z",
    endExclusive: "2026-12-15T06:00:00.000Z",
  });
  assert.deepEqual(getSpecComDayBounds("2026-03-08"), {
    start: "2026-03-08T06:00:00.000Z",
    endExclusive: "2026-03-09T05:00:00.000Z",
  });
});

test("active-day detection uses the SpecCom date near a UTC boundary", () => {
  const result = assessReportDuration({
    startedAt: "2026-07-21T20:00:00-05:00",
    endedAt: null,
    workDate: "2026-07-21",
    now: new Date("2026-07-22T02:00:00Z"),
  });
  assert.equal(result.status, REPORT_TIME_STATUS.ACTIVE);
  assert.equal(result.minutes, 60);
});

test("project report range enumerates inclusive calendar dates", () => {
  assert.deepEqual(getDateKeysInRange("2026-07-01", "2026-07-03"), ["2026-07-01", "2026-07-02", "2026-07-03"]);
  assert.deepEqual(getDateKeysInRange("2026-07-03", "2026-07-01"), []);
});

test("completed historical session uses its timestamps", () => {
  const result = assessReportDuration({ startedAt: "2026-07-14T08:00:00-05:00", endedAt: "2026-07-14T16:30:00-05:00", workDate: "2026-07-14", now: NOW });
  assert.equal(result.status, REPORT_TIME_STATUS.VALID);
  assert.equal(result.minutes, 510);
});

test("historical session missing an end is excluded", () => {
  const result = assessReportDuration({ startedAt: "2026-07-14T08:00:00-05:00", endedAt: null, workDate: "2026-07-14", now: NOW });
  assert.equal(result.status, REPORT_TIME_STATUS.MISSING_END);
  assert.equal(result.minutes, 0);
  assert.equal(result.included, false);
  const total = calculateWorkedTime([{ id: "july-14-open", work_date: "2026-07-14", started_at: "2026-07-14T08:00:00-05:00", ended_at: null }], [], { workDate: "2026-07-14", now: NOW });
  assert.equal(total.minutes, 0);
  assert.equal(total.warnings[0].label, "Missing End Time");
});

test("unfinished session today is active through the current time", () => {
  const result = assessReportDuration({ startedAt: "2026-07-21T08:00:00-05:00", endedAt: null, workDate: "2026-07-21", now: NOW });
  assert.equal(result.status, REPORT_TIME_STATUS.ACTIVE);
  assert.equal(result.minutes, 600);
});

test("end time before start is invalid and excluded", () => {
  const result = assessReportDuration({ startedAt: "2026-07-14T10:00:00-05:00", endedAt: "2026-07-14T09:00:00-05:00", workDate: "2026-07-14", now: NOW });
  assert.equal(result.status, REPORT_TIME_STATUS.END_NOT_AFTER_START);
  assert.equal(result.included, false);
});

test("session longer than 24 hours is invalid and excluded", () => {
  const result = assessReportDuration({ startedAt: "2026-07-13T08:00:00-05:00", endedAt: "2026-07-14T08:01:00-05:00", workDate: "2026-07-13", now: NOW });
  assert.equal(result.status, REPORT_TIME_STATUS.OVER_24_HOURS);
  assert.equal(result.included, false);
});

test("overlapping inspection and location detail does not increase worked time", () => {
  const result = calculateWorkedTime(
    [{ id: "day", work_date: "2026-07-14", started_at: "2026-07-14T08:00:00-05:00", ended_at: "2026-07-14T16:00:00-05:00" }],
    [
      { id: "inspection", event_type: "VEHICLE_INSPECTION", started_at: "2026-07-14T08:00:00-05:00", ended_at: "2026-07-14T08:30:00-05:00" },
      { id: "location", event_type: "LOCATION_WORK", started_at: "2026-07-14T08:15:00-05:00", ended_at: "2026-07-14T12:00:00-05:00" },
    ],
    { workDate: "2026-07-14", now: NOW },
  );
  assert.equal(result.minutes, 480);
});

test("completed overlapping break and lunch time is subtracted once", () => {
  const result = calculateWorkedTime(
    [{ id: "day", work_date: "2026-07-14", started_at: "2026-07-14T08:00:00-05:00", ended_at: "2026-07-14T17:00:00-05:00" }],
    [
      { id: "break", event_type: "BREAK_15", started_at: "2026-07-14T10:00:00-05:00", ended_at: "2026-07-14T10:15:00-05:00" },
      { id: "lunch", event_type: "LUNCH", started_at: "2026-07-14T12:00:00-05:00", ended_at: "2026-07-14T12:30:00-05:00" },
      { id: "duplicate", event_type: "LUNCH", started_at: "2026-07-14T12:15:00-05:00", ended_at: "2026-07-14T12:45:00-05:00" },
    ],
    { workDate: "2026-07-14", now: NOW },
  );
  assert.equal(result.grossMinutes, 540);
  assert.equal(result.breakMinutes, 60);
  assert.equal(result.minutes, 480);
});

test("multiple valid sessions on one date are summed without overlap", () => {
  const result = calculateWorkedTime([
    { id: "morning", work_date: "2026-07-14", started_at: "2026-07-14T08:00:00-05:00", ended_at: "2026-07-14T12:00:00-05:00" },
    { id: "afternoon", work_date: "2026-07-14", started_at: "2026-07-14T13:00:00-05:00", ended_at: "2026-07-14T17:00:00-05:00" },
  ], [], { workDate: "2026-07-14", now: NOW });
  assert.equal(result.minutes, 480);
});
