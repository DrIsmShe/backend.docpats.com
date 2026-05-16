// server/__tests__/clinic-appointments/appointment.validator.test.js
//
// Pure-function tests for the 5 appointment validators.
//
//   - validateCreateAppointment
//   - validateRescheduleAppointment
//   - validateStatusChange
//   - validateListAppointments
//   - validateFreeSlotsQuery
//
// All five are pure: no DB, no tenant context, no IO. They take raw
// input and either return a normalized object or throw ValidationError.
//
// Test groups:
//   basics    — happy paths return well-shaped objects
//   errors    — every throwing branch (missing/wrong/out-of-range)
//   security  — normalization can't be tricked (whitespace, types)
//   edges     — boundary values that are technically legal
//
// No setup needed — these tests are independent of the global
// mongodb-memory-server.

import { describe, it, expect } from "vitest";
import mongoose from "mongoose";

import {
  validateCreateAppointment,
  validateRescheduleAppointment,
  validateStatusChange,
  validateListAppointments,
  validateFreeSlotsQuery,
} from "../../modules/clinic/clinic-appointments/validators/appointment.validator.js";
import { ValidationError } from "../../common/utils/errors.js";

// ─── Fixtures ──────────────────────────────────────────────────

const VALID_ID = new mongoose.Types.ObjectId().toString();
const OTHER_ID = new mongoose.Types.ObjectId().toString();

// A safe near-future booking — 1 day ahead, 30 minutes long.
function tomorrow0900() {
  const t = new Date();
  t.setUTCDate(t.getUTCDate() + 1);
  t.setUTCHours(9, 0, 0, 0);
  return t;
}
function tomorrow0930() {
  const t = tomorrow0900();
  t.setUTCMinutes(30);
  return t;
}

const VALID_CREATE = () => ({
  doctorId: VALID_ID,
  patientId: OTHER_ID,
  startUTC: tomorrow0900().toISOString(),
  endUTC: tomorrow0930().toISOString(),
  reason: "test visit",
});

// ════════════════════════════════════════════════════════════════
//  validateCreateAppointment
// ════════════════════════════════════════════════════════════════

describe("validateCreateAppointment — basics", () => {
  it("normalises a fully-valid payload", () => {
    const r = validateCreateAppointment(VALID_CREATE());
    expect(r.doctorId).toBe(VALID_ID);
    expect(r.patientId).toBe(OTHER_ID);
    expect(r.startUTC).toBeInstanceOf(Date);
    expect(r.endUTC).toBeInstanceOf(Date);
    expect(r.reason).toBe("test visit");
  });

  it("trims surrounding whitespace from reason", () => {
    const r = validateCreateAppointment({
      ...VALID_CREATE(),
      reason: "   chest pain   ",
    });
    expect(r.reason).toBe("chest pain");
  });

  it("returns null reason when omitted", () => {
    const raw = VALID_CREATE();
    delete raw.reason;
    expect(validateCreateAppointment(raw).reason).toBeNull();
  });

  it("returns null reason when explicitly empty string", () => {
    const r = validateCreateAppointment({ ...VALID_CREATE(), reason: "" });
    expect(r.reason).toBeNull();
  });

  it("accepts Date instances directly (not just ISO strings)", () => {
    const r = validateCreateAppointment({
      ...VALID_CREATE(),
      startUTC: tomorrow0900(),
      endUTC: tomorrow0930(),
    });
    expect(r.startUTC.getTime()).toBe(tomorrow0900().getTime());
  });
});

describe("validateCreateAppointment — errors", () => {
  it("throws on missing body", () => {
    expect(() => validateCreateAppointment(null)).toThrow(ValidationError);
    expect(() => validateCreateAppointment(undefined)).toThrow(ValidationError);
    expect(() => validateCreateAppointment("not-an-object")).toThrow(
      ValidationError,
    );
  });

  it("throws on missing doctorId", () => {
    const raw = VALID_CREATE();
    delete raw.doctorId;
    try {
      validateCreateAppointment(raw);
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      expect(e.details?.field).toBe("doctorId");
    }
  });

  it("throws on malformed doctorId", () => {
    expect(() =>
      validateCreateAppointment({ ...VALID_CREATE(), doctorId: "not-an-id" }),
    ).toThrow(ValidationError);
  });

  it("throws on missing patientId", () => {
    const raw = VALID_CREATE();
    delete raw.patientId;
    try {
      validateCreateAppointment(raw);
      throw new Error("expected throw");
    } catch (e) {
      expect(e.details?.field).toBe("patientId");
    }
  });

  it("throws on missing startUTC", () => {
    const raw = VALID_CREATE();
    delete raw.startUTC;
    expect(() => validateCreateAppointment(raw)).toThrow(/startUTC/);
  });

  it("throws on invalid date string", () => {
    expect(() =>
      validateCreateAppointment({
        ...VALID_CREATE(),
        startUTC: "yesterday morning",
      }),
    ).toThrow(ValidationError);
  });

  it("throws when endUTC equals startUTC", () => {
    const t = tomorrow0900().toISOString();
    expect(() =>
      validateCreateAppointment({
        ...VALID_CREATE(),
        startUTC: t,
        endUTC: t,
      }),
    ).toThrow(ValidationError);
  });

  it("throws when endUTC precedes startUTC", () => {
    expect(() =>
      validateCreateAppointment({
        ...VALID_CREATE(),
        startUTC: tomorrow0930().toISOString(),
        endUTC: tomorrow0900().toISOString(),
      }),
    ).toThrow(ValidationError);
  });

  it("rejects too-short (1-minute) appointment", () => {
    const start = tomorrow0900();
    const end = new Date(start.getTime() + 60 * 1000);
    expect(() =>
      validateCreateAppointment({
        ...VALID_CREATE(),
        startUTC: start.toISOString(),
        endUTC: end.toISOString(),
      }),
    ).toThrow(ValidationError);
  });

  it("rejects too-long appointment (>24h)", () => {
    const start = tomorrow0900();
    const end = new Date(start.getTime() + 25 * 60 * 60 * 1000);
    expect(() =>
      validateCreateAppointment({
        ...VALID_CREATE(),
        startUTC: start.toISOString(),
        endUTC: end.toISOString(),
      }),
    ).toThrow(ValidationError);
  });

  it("rejects booking too far in the future (>365 days)", () => {
    const start = new Date();
    start.setUTCDate(start.getUTCDate() + 400);
    const end = new Date(start.getTime() + 30 * 60 * 1000);
    expect(() =>
      validateCreateAppointment({
        ...VALID_CREATE(),
        startUTC: start.toISOString(),
        endUTC: end.toISOString(),
      }),
    ).toThrow(/too far in the future/);
  });

  it("rejects reason longer than REASON_MAX_LENGTH (2000)", () => {
    expect(() =>
      validateCreateAppointment({
        ...VALID_CREATE(),
        reason: "x".repeat(2001),
      }),
    ).toThrow(ValidationError);
  });

  it("rejects non-string reason", () => {
    expect(() =>
      validateCreateAppointment({ ...VALID_CREATE(), reason: 12345 }),
    ).toThrow(ValidationError);
  });
});

describe("validateCreateAppointment — edges", () => {
  it("accepts exactly 5-minute appointment (minimum)", () => {
    const start = tomorrow0900();
    const end = new Date(start.getTime() + 5 * 60 * 1000);
    expect(() =>
      validateCreateAppointment({
        ...VALID_CREATE(),
        startUTC: start.toISOString(),
        endUTC: end.toISOString(),
      }),
    ).not.toThrow();
  });

  it("accepts exactly 24-hour appointment (maximum)", () => {
    const start = tomorrow0900();
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    expect(() =>
      validateCreateAppointment({
        ...VALID_CREATE(),
        startUTC: start.toISOString(),
        endUTC: end.toISOString(),
      }),
    ).not.toThrow();
  });

  it("accepts reason of exactly 2000 chars", () => {
    expect(() =>
      validateCreateAppointment({
        ...VALID_CREATE(),
        reason: "x".repeat(2000),
      }),
    ).not.toThrow();
  });
});

// ════════════════════════════════════════════════════════════════
//  validateRescheduleAppointment
// ════════════════════════════════════════════════════════════════

describe("validateRescheduleAppointment", () => {
  it("happy path with reason omitted", () => {
    const r = validateRescheduleAppointment({
      startUTC: tomorrow0900().toISOString(),
      endUTC: tomorrow0930().toISOString(),
    });
    expect(r.startUTC).toBeInstanceOf(Date);
    expect(r.endUTC).toBeInstanceOf(Date);
    expect(r).not.toHaveProperty("reason");
  });

  it("includes reason when supplied", () => {
    const r = validateRescheduleAppointment({
      startUTC: tomorrow0900().toISOString(),
      endUTC: tomorrow0930().toISOString(),
      reason: "  needs longer slot  ",
    });
    expect(r.reason).toBe("needs longer slot");
  });

  it("accepts null reason explicitly (clears the field)", () => {
    const r = validateRescheduleAppointment({
      startUTC: tomorrow0900().toISOString(),
      endUTC: tomorrow0930().toISOString(),
      reason: null,
    });
    expect(r).toHaveProperty("reason");
    expect(r.reason).toBeNull();
  });

  it("throws when end <= start", () => {
    const t = tomorrow0900().toISOString();
    expect(() =>
      validateRescheduleAppointment({ startUTC: t, endUTC: t }),
    ).toThrow(ValidationError);
  });

  it("throws on missing body", () => {
    expect(() => validateRescheduleAppointment(null)).toThrow(ValidationError);
  });

  it("ignores extra fields (doesn't carry doctorId/patientId through)", () => {
    const r = validateRescheduleAppointment({
      doctorId: VALID_ID,
      patientId: OTHER_ID,
      startUTC: tomorrow0900().toISOString(),
      endUTC: tomorrow0930().toISOString(),
    });
    expect(r).not.toHaveProperty("doctorId");
    expect(r).not.toHaveProperty("patientId");
  });
});

// ════════════════════════════════════════════════════════════════
//  validateStatusChange
// ════════════════════════════════════════════════════════════════

describe("validateStatusChange — basics", () => {
  it("accepts checked_in / completed / cancelled / no_show", () => {
    for (const status of ["checked_in", "completed", "cancelled", "no_show"]) {
      const r = validateStatusChange({ status });
      expect(r.status).toBe(status);
    }
  });

  it("includes cancelReason when transition is cancelled", () => {
    const r = validateStatusChange({
      status: "cancelled",
      cancelReason: "  patient rescheduled  ",
    });
    expect(r.cancelReason).toBe("patient rescheduled");
  });

  it("cancelReason omitted means undefined / no field", () => {
    const r = validateStatusChange({ status: "cancelled" });
    expect(r).toHaveProperty("cancelReason");
    expect(r.cancelReason).toBeNull();
  });
});

describe("validateStatusChange — errors", () => {
  it("throws on unknown status", () => {
    expect(() => validateStatusChange({ status: "in_progress" })).toThrow(
      /not a valid appointment status/,
    );
  });

  it("throws when status is 'scheduled' (cannot set explicitly)", () => {
    expect(() => validateStatusChange({ status: "scheduled" })).toThrow(
      /cannot be set explicitly/,
    );
  });

  it("throws when cancelReason supplied for non-cancelled status", () => {
    expect(() =>
      validateStatusChange({
        status: "completed",
        cancelReason: "weird",
      }),
    ).toThrow(/only allowed when status is 'cancelled'/);
  });

  it("throws on missing body", () => {
    expect(() => validateStatusChange(null)).toThrow(ValidationError);
  });

  it("throws when status field is absent", () => {
    expect(() => validateStatusChange({})).toThrow(ValidationError);
  });
});

// ════════════════════════════════════════════════════════════════
//  validateListAppointments
// ════════════════════════════════════════════════════════════════

describe("validateListAppointments — doctor mode", () => {
  it("happy path", () => {
    const r = validateListAppointments({
      doctorId: VALID_ID,
      from: "2026-05-18",
      to: "2026-05-24",
    });
    expect(r.doctorId).toBe(VALID_ID);
    expect(r.from).toBe("2026-05-18");
    expect(r.to).toBe("2026-05-24");
  });

  it("accepts optional status filter", () => {
    const r = validateListAppointments({
      doctorId: VALID_ID,
      from: "2026-05-18",
      to: "2026-05-24",
      status: "scheduled",
    });
    expect(r.status).toBe("scheduled");
  });

  it("throws if doctorId+patientId both missing", () => {
    expect(() =>
      validateListAppointments({ from: "2026-05-18", to: "2026-05-24" }),
    ).toThrow(/doctorId or patientId/);
  });

  it("throws if doctor mode missing window", () => {
    expect(() => validateListAppointments({ doctorId: VALID_ID })).toThrow(
      /from/,
    );
  });

  it("throws if from > to", () => {
    expect(() =>
      validateListAppointments({
        doctorId: VALID_ID,
        from: "2026-05-24",
        to: "2026-05-18",
      }),
    ).toThrow(/from must be on or before to/);
  });

  it("throws on window > 92 days", () => {
    expect(() =>
      validateListAppointments({
        doctorId: VALID_ID,
        from: "2026-01-01",
        to: "2026-12-31",
      }),
    ).toThrow(/window too large/);
  });

  it("throws on malformed date format", () => {
    expect(() =>
      validateListAppointments({
        doctorId: VALID_ID,
        from: "May 18",
        to: "2026-05-24",
      }),
    ).toThrow(/YYYY-MM-DD/);
  });

  it("throws on invalid calendar date (Feb 30)", () => {
    expect(() =>
      validateListAppointments({
        doctorId: VALID_ID,
        from: "2026-02-30",
        to: "2026-03-15",
      }),
    ).toThrow(/not a real calendar date/);
  });
});

describe("validateListAppointments — patient mode", () => {
  it("happy path with defaults", () => {
    const r = validateListAppointments({ patientId: VALID_ID });
    expect(r.patientId).toBe(VALID_ID);
    expect(r.limit).toBeUndefined(); // service applies default
  });

  it("accepts limit as string and coerces to number", () => {
    const r = validateListAppointments({
      patientId: VALID_ID,
      limit: "50",
    });
    expect(r.limit).toBe(50);
    expect(typeof r.limit).toBe("number");
  });

  it("throws on limit out of range", () => {
    expect(() =>
      validateListAppointments({ patientId: VALID_ID, limit: "500" }),
    ).toThrow(/limit must be an integer 1\.\.100/);
  });

  it("throws on negative limit", () => {
    expect(() =>
      validateListAppointments({ patientId: VALID_ID, limit: "-1" }),
    ).toThrow(/limit/);
  });

  it("accepts before cursor (ISO timestamp)", () => {
    const r = validateListAppointments({
      patientId: VALID_ID,
      before: "2026-05-18T05:00:00Z",
    });
    expect(r.before).toBeInstanceOf(Date);
  });

  it("throws on invalid before cursor", () => {
    expect(() =>
      validateListAppointments({
        patientId: VALID_ID,
        before: "junk",
      }),
    ).toThrow(/before/);
  });

  it("throws on unknown status filter", () => {
    expect(() =>
      validateListAppointments({ patientId: VALID_ID, status: "weird" }),
    ).toThrow(/status/);
  });
});

// ════════════════════════════════════════════════════════════════
//  validateFreeSlotsQuery
// ════════════════════════════════════════════════════════════════

describe("validateFreeSlotsQuery", () => {
  it("happy path", () => {
    const r = validateFreeSlotsQuery({
      doctorId: VALID_ID,
      from: "2026-05-18",
      to: "2026-05-24",
    });
    expect(r.doctorId).toBe(VALID_ID);
    expect(r.from).toBe("2026-05-18");
    expect(r.to).toBe("2026-05-24");
  });

  it("throws if doctorId missing", () => {
    expect(() =>
      validateFreeSlotsQuery({ from: "2026-05-18", to: "2026-05-24" }),
    ).toThrow(/doctorId/);
  });

  it("throws if from missing", () => {
    expect(() =>
      validateFreeSlotsQuery({ doctorId: VALID_ID, to: "2026-05-24" }),
    ).toThrow(/from/);
  });

  it("throws if to missing", () => {
    expect(() =>
      validateFreeSlotsQuery({ doctorId: VALID_ID, from: "2026-05-18" }),
    ).toThrow(/to/);
  });

  it("throws on malformed doctorId", () => {
    expect(() =>
      validateFreeSlotsQuery({
        doctorId: "not-an-id",
        from: "2026-05-18",
        to: "2026-05-24",
      }),
    ).toThrow(ValidationError);
  });
});
