// __tests__/clinic-appointments/slot.service.test.js
//
// Tests for slot.service.js (day-3 of Sprint 1, clinic Appointments).
//
// Structure mirrors the existing day-6 service tests:
//   - real mongodb-memory-server (no mocks)
//   - tenantContext via runWithTenantContext
//   - real Clinic/Schedule/Exception documents created in beforeEach
//
// Coverage:
//   1) sliceInterval                 — pure unit, no DB           (5)
//   2) weekdayInTimezone             — pure unit, no DB           (3)
//   3) computeSlots — validation     — input gating               (4)
//   4) computeSlots — schedule logic — weekly pattern resolution  (4)
//   5) computeSlots — exceptions     — day_off / custom override  (3)
//
// Total: 19 tests.
//
// NOTE on dates used:
//   FAR_FUTURE_DATE       = "2026-08-17" → Monday in Asia/Baku
//   FAR_FUTURE_DATE_TUE   = "2026-08-18" → Tuesday
//   FAR_FUTURE_DATE_SUN   = "2026-08-16" → Sunday
//   FAR_FUTURE_DATE_SAT   = "2026-08-22" → Saturday
// Verified via standard JS Date: 2026-08-17 is a Monday.

import { describe, it, expect, beforeEach } from "vitest";
import mongoose from "mongoose";

import {
  computeSlots,
  sliceInterval,
  weekdayInTimezone,
} from "../../modules/clinic/clinic-appointments/services/slot.service.js";

import ClinicDoctorSchedule from "../../modules/clinic/clinic-appointments/models/clinicDoctorSchedule.model.js";
import ClinicScheduleException from "../../modules/clinic/clinic-appointments/models/clinicScheduleException.model.js";
import Clinic from "../../modules/clinic/clinic-core/models/clinic.model.js";

import { localMidnightToUTC } from "../../modules/clinic/clinic-appointments/services/scheduleException.service.js";

import { runWithTenantContext } from "../../common/context/tenantContext.js";
import { ValidationError, ForbiddenError } from "../../common/utils/errors.js";

// ─── Test fixtures (reset per test) ───────────────────────────────────

let clinicId;
let doctorId;
let userId; // actor (owner)

const TZ = "Asia/Baku"; // UTC+4, no DST → predictable arithmetic
const FAR_FUTURE_DATE = "2026-08-17"; // Monday
const FAR_FUTURE_DATE_TUE = "2026-08-18"; // Tuesday
const FAR_FUTURE_DATE_SUN = "2026-08-16"; // Sunday
const FAR_FUTURE_DATE_SAT = "2026-08-22"; // Saturday

// Run a function inside a tenant context — matches the harness used in
// appointment.service.test.js (no surprises).
function withCtx(fn, role = "owner") {
  return runWithTenantContext(
    {
      clinicId,
      userId,
      actorType: "user",
      role,
    },
    fn,
  );
}

beforeEach(async () => {
  // Mint fresh ObjectIds for every test
  clinicId = new mongoose.Types.ObjectId();
  doctorId = new mongoose.Types.ObjectId();
  userId = new mongoose.Types.ObjectId();

  // Clean collections — global setup deletes too, but explicit is safe
  await Clinic.collection.deleteMany({});
  await ClinicDoctorSchedule.collection.deleteMany({});
  await ClinicScheduleException.collection.deleteMany({});

  // Real Clinic doc — resolveClinicTimezone reads timezone from it
  await Clinic.create({
    _id: clinicId,
    name: "Test Clinic",
    slug: `test-clinic-${clinicId.toString().slice(-8)}`,
    ownerId: userId,
    timezone: TZ,
  });
});

// ════════════════════════════════════════════════════════════════════
//  1. sliceInterval — pure unit tests (no DB, no context)
// ════════════════════════════════════════════════════════════════════

describe("sliceInterval — pure slot-slicing math", () => {
  it("slices a clean interval with no buffer into exact slots", () => {
    // 09:00 (540) to 10:00 (600), 30min slots, no buffer → 2 slots
    const out = sliceInterval(540, 600, 30, 0);
    expect(out).toEqual([
      { startMinute: 540, endMinute: 570 },
      { startMinute: 570, endMinute: 600 },
    ]);
  });

  it("respects buffer between slots (step = slot + buffer)", () => {
    // 09:00–10:00, 25min slot + 5min buffer = step 30 → 2 slots
    const out = sliceInterval(540, 600, 25, 5);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ startMinute: 540, endMinute: 565 });
    expect(out[1]).toEqual({ startMinute: 570, endMinute: 595 });
    // Buffer is NOT appended after the last slot — the interval just ends
    // before another could start (595 + 5 + 25 = 625 > 600).
  });

  it("emits only slots that fully fit (partial trailing slot dropped)", () => {
    // 09:00–09:50, 30min slots, no buffer
    // slot 1: 09:00–09:30 ✓ ; slot 2: 09:30–10:00 — 10:00 > 09:50, dropped
    const out = sliceInterval(540, 590, 30, 0);
    expect(out).toEqual([{ startMinute: 540, endMinute: 570 }]);
  });

  it("returns [] for an empty / inverted interval", () => {
    expect(sliceInterval(600, 600, 30, 0)).toEqual([]);
    expect(sliceInterval(600, 540, 30, 0)).toEqual([]); // end < start
  });

  it("returns [] for zero or negative slot duration", () => {
    expect(sliceInterval(540, 600, 0, 0)).toEqual([]);
    expect(sliceInterval(540, 600, -30, 0)).toEqual([]);
  });
});

// ════════════════════════════════════════════════════════════════════
//  2. weekdayInTimezone — pure unit tests
// ════════════════════════════════════════════════════════════════════

describe("weekdayInTimezone — JS Date.getDay() convention", () => {
  it("2026-08-17 in Asia/Baku is Monday (1)", () => {
    expect(weekdayInTimezone(TZ, 2026, 8, 17)).toBe(1);
  });

  it("2026-08-16 in Asia/Baku is Sunday (0)", () => {
    expect(weekdayInTimezone(TZ, 2026, 8, 16)).toBe(0);
  });

  it("2026-08-22 in Asia/Baku is Saturday (6)", () => {
    expect(weekdayInTimezone(TZ, 2026, 8, 22)).toBe(6);
  });
});

// ════════════════════════════════════════════════════════════════════
//  3. computeSlots — input validation
// ════════════════════════════════════════════════════════════════════

describe("computeSlots — validation", () => {
  it("throws ForbiddenError if no clinic context", async () => {
    // Call OUTSIDE runWithTenantContext → getCurrentClinicId() returns
    // undefined → requireClinicId() throws ForbiddenError.
    await expect(
      computeSlots(String(doctorId), {
        from: FAR_FUTURE_DATE,
        to: FAR_FUTURE_DATE,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("throws ValidationError on invalid doctorId", async () => {
    await expect(
      withCtx(() =>
        computeSlots("not-an-objectid", {
          from: FAR_FUTURE_DATE,
          to: FAR_FUTURE_DATE,
        }),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("throws ValidationError when from > to", async () => {
    await expect(
      withCtx(() =>
        computeSlots(String(doctorId), {
          from: FAR_FUTURE_DATE_TUE, // later
          to: FAR_FUTURE_DATE, // earlier
        }),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("throws ValidationError when window exceeds 62 days", async () => {
    // 2026-01-01 → 2026-04-30 = 120 days > 62
    await expect(
      withCtx(() =>
        computeSlots(String(doctorId), {
          from: "2026-01-01",
          to: "2026-04-30",
        }),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

// ════════════════════════════════════════════════════════════════════
//  4. computeSlots — schedule resolution (weekly pattern)
// ════════════════════════════════════════════════════════════════════

describe("computeSlots — weekly schedule resolution", () => {
  it("returns all-empty days when the doctor has NO schedule at all", async () => {
    // No Schedule doc created → service returns days with slots: []
    const result = await withCtx(() =>
      computeSlots(String(doctorId), {
        from: FAR_FUTURE_DATE, // Mon
        to: FAR_FUTURE_DATE_TUE, // Tue
      }),
    );

    expect(result.doctorId).toBe(String(doctorId));
    expect(result.timezone).toBe(TZ);
    expect(result.days).toHaveLength(2);
    expect(result.days[0].date).toBe(FAR_FUTURE_DATE);
    expect(result.days[0].slots).toEqual([]);
    expect(result.days[1].slots).toEqual([]);
  });

  it("returns slots ONLY on configured weekdays (Mon yes, Tue no)", async () => {
    // Schedule: Monday (weekday=1) 09:00–10:00 only.
    // Window covers Mon and Tue.
    await ClinicDoctorSchedule.create({
      clinicId,
      doctorId,
      weeklyHours: [
        {
          weekday: 1, // Monday
          intervals: [{ startMinute: 540, endMinute: 600 }], // 09:00–10:00
        },
      ],
      slotDurationMinutes: 30,
      bufferMinutes: 0,
      isActive: true,
      createdBy: userId,
      createdByType: "user",
    });

    const result = await withCtx(() =>
      computeSlots(String(doctorId), {
        from: FAR_FUTURE_DATE, // Mon
        to: FAR_FUTURE_DATE_TUE, // Tue
      }),
    );

    expect(result.days).toHaveLength(2);

    // Monday — two 30min slots
    expect(result.days[0].date).toBe(FAR_FUTURE_DATE);
    expect(result.days[0].slots).toHaveLength(2);
    expect(result.days[0].slots[0].startMinute).toBe(540);
    expect(result.days[0].slots[0].endMinute).toBe(570);
    expect(result.days[0].slots[1].startMinute).toBe(570);

    // Tuesday — no weekday entry → no slots
    expect(result.days[1].date).toBe(FAR_FUTURE_DATE_TUE);
    expect(result.days[1].slots).toEqual([]);
  });

  it("yields ZERO slots when schedule exists but isActive=false", async () => {
    // Same Monday pattern, but the whole schedule is switched off.
    await ClinicDoctorSchedule.create({
      clinicId,
      doctorId,
      weeklyHours: [
        {
          weekday: 1,
          intervals: [{ startMinute: 540, endMinute: 600 }],
        },
      ],
      slotDurationMinutes: 30,
      bufferMinutes: 0,
      isActive: false, // ← the gate
      createdBy: userId,
      createdByType: "user",
    });

    const result = await withCtx(() =>
      computeSlots(String(doctorId), {
        from: FAR_FUTURE_DATE,
        to: FAR_FUTURE_DATE,
      }),
    );

    expect(result.days).toHaveLength(1);
    expect(result.days[0].slots).toEqual([]);
  });

  it("slot count and timing reflect slotDurationMinutes + bufferMinutes", async () => {
    // 09:00–11:00 (120min interval), slot=25, buffer=5 → step 30 → 4 slots
    // Slot starts: 540, 570, 600, 630.  Last slot ends at 655 ≤ 660 (11:00).
    await ClinicDoctorSchedule.create({
      clinicId,
      doctorId,
      weeklyHours: [
        {
          weekday: 1,
          intervals: [{ startMinute: 540, endMinute: 660 }], // 09:00–11:00
        },
      ],
      slotDurationMinutes: 25,
      bufferMinutes: 5,
      isActive: true,
      createdBy: userId,
      createdByType: "user",
    });

    const result = await withCtx(() =>
      computeSlots(String(doctorId), {
        from: FAR_FUTURE_DATE, // Mon
        to: FAR_FUTURE_DATE,
      }),
    );

    expect(result.slotDurationMinutes).toBe(25);
    expect(result.bufferMinutes).toBe(5);
    expect(result.days[0].slots).toHaveLength(4);
    expect(result.days[0].slots.map((s) => s.startMinute)).toEqual([
      540, 570, 600, 630,
    ]);
    expect(result.days[0].slots.map((s) => s.endMinute)).toEqual([
      565, 595, 625, 655,
    ]);
    // Spot-check startUTC: Asia/Baku is UTC+4, no DST in August.
    // 2026-08-17 09:00 local = 2026-08-17 05:00 UTC
    expect(result.days[0].slots[0].startUTC).toBe("2026-08-17T05:00:00.000Z");
  });
});

// ════════════════════════════════════════════════════════════════════
//  5. computeSlots — exceptions (per-date overrides)
// ════════════════════════════════════════════════════════════════════

describe("computeSlots — schedule exceptions", () => {
  it('type "day_off" on a working day returns NO slots that date', async () => {
    // Weekly: Mon 09:00–10:00. Window: Mon 17 + Mon 24 (one week apart).
    // Add a day_off ONLY on the 17th — the 24th should still have slots.
    await ClinicDoctorSchedule.create({
      clinicId,
      doctorId,
      weeklyHours: [
        {
          weekday: 1, // Monday
          intervals: [{ startMinute: 540, endMinute: 600 }],
        },
      ],
      slotDurationMinutes: 30,
      bufferMinutes: 0,
      isActive: true,
      createdBy: userId,
      createdByType: "user",
    });

    // Exception: 2026-08-17 day_off
    await ClinicScheduleException.create({
      clinicId,
      doctorId,
      date: localMidnightToUTC(TZ, 2026, 8, 17),
      type: "day_off",
      intervals: [],
      note: "Vacation",
      createdBy: userId,
      createdByType: "user",
    });

    const result = await withCtx(() =>
      computeSlots(String(doctorId), {
        from: "2026-08-17", // Mon — day_off
        to: "2026-08-24", // following Mon
      }),
    );

    // Mon 17: empty (day_off)
    const mon17 = result.days.find((d) => d.date === "2026-08-17");
    expect(mon17).toBeDefined();
    expect(mon17.slots).toEqual([]);

    // Mon 24: weekly pattern still applies → 2 slots
    const mon24 = result.days.find((d) => d.date === "2026-08-24");
    expect(mon24).toBeDefined();
    expect(mon24.slots).toHaveLength(2);
  });

  it('type "custom" REPLACES the weekday pattern with the exception intervals', async () => {
    // Weekly: Mon 09:00–10:00. Custom override on Mon 17: 14:00–15:00.
    // Expect Mon 17 to use the CUSTOM hours only — not the weekly ones.
    await ClinicDoctorSchedule.create({
      clinicId,
      doctorId,
      weeklyHours: [
        {
          weekday: 1,
          intervals: [{ startMinute: 540, endMinute: 600 }], // 09:00–10:00
        },
      ],
      slotDurationMinutes: 30,
      bufferMinutes: 0,
      isActive: true,
      createdBy: userId,
      createdByType: "user",
    });

    await ClinicScheduleException.create({
      clinicId,
      doctorId,
      date: localMidnightToUTC(TZ, 2026, 8, 17),
      type: "custom",
      intervals: [{ startMinute: 840, endMinute: 900 }], // 14:00–15:00
      note: "Late start",
      createdBy: userId,
      createdByType: "user",
    });

    const result = await withCtx(() =>
      computeSlots(String(doctorId), {
        from: FAR_FUTURE_DATE,
        to: FAR_FUTURE_DATE,
      }),
    );

    expect(result.days).toHaveLength(1);
    expect(result.days[0].slots).toHaveLength(2);
    // ONLY the custom hours — weekly 09–10 was dropped
    expect(result.days[0].slots.map((s) => s.startMinute)).toEqual([840, 870]);
    // Sanity: no slot at 09:00 (540) — would indicate weekly pattern leaked in
    expect(
      result.days[0].slots.find((s) => s.startMinute === 540),
    ).toBeUndefined();
  });

  it("exceptions outside the requested window are ignored", async () => {
    // Weekly Mon 09–10. Exception: day_off on the FOLLOWING Monday (24th).
    // Query window is the 17th only → 24th's exception must NOT affect it.
    await ClinicDoctorSchedule.create({
      clinicId,
      doctorId,
      weeklyHours: [
        {
          weekday: 1,
          intervals: [{ startMinute: 540, endMinute: 600 }],
        },
      ],
      slotDurationMinutes: 30,
      bufferMinutes: 0,
      isActive: true,
      createdBy: userId,
      createdByType: "user",
    });

    await ClinicScheduleException.create({
      clinicId,
      doctorId,
      date: localMidnightToUTC(TZ, 2026, 8, 24), // outside window
      type: "day_off",
      intervals: [],
      createdBy: userId,
      createdByType: "user",
    });

    const result = await withCtx(() =>
      computeSlots(String(doctorId), {
        from: FAR_FUTURE_DATE, // 2026-08-17
        to: FAR_FUTURE_DATE, // 2026-08-17
      }),
    );

    // The 17th still uses the weekly pattern — 2 slots — the 24th's
    // day_off must not bleed in.
    expect(result.days).toHaveLength(1);
    expect(result.days[0].date).toBe(FAR_FUTURE_DATE);
    expect(result.days[0].slots).toHaveLength(2);
  });
});
