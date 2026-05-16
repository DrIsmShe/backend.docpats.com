// __tests__/clinic-appointments/appointment-conflicts.test.js
//
// Exhaustive overlap-detection tests for assertNoConflict, the core
// scheduling primitive in appointment.service.js.
//
// Why a dedicated file (separate from appointment.service.test.js):
//   - The service tests cover conflict at the level of the public
//     createAppointment / rescheduleAppointment APIs, with all the
//     surrounding role / membership / patient existence checks.
//   - This file isolates assertNoConflict and walks every interval
//     relation systematically, so a future refactor that breaks the
//     overlap math is caught here even if the higher-level tests
//     happen to look fine.
//
// Allen's interval algebra has 13 base relations; for overlap detection
// the rule is the standard:
//
//     overlap(A, B)  ⇔  A.start < B.end  ∧  A.end > B.start
//
// That collapses Allen's 13 to two equivalence classes for our purpose:
//   - 7 relations imply overlap (throws ConflictError)
//   - 6 relations imply NO overlap (resolves silently)
//
// We cover the meaningful ones below (some Allen pairs collapse on our
// "doctor-day" scope, e.g. `starts` vs `started-by` are symmetric here),
// plus two extra invariants:
//   - cancelled / completed appointments do NOT count as conflicts
//   - excludeId lets the SAME appointment skip itself (used by reschedule)
//
// Coverage: 13 tests in one describe block.

import { describe, it, expect, beforeEach } from "vitest";
import mongoose from "mongoose";

import { assertNoConflict } from "../../modules/clinic/clinic-appointments/services/appointment.service.js";
import ClinicAppointment from "../../modules/clinic/clinic-appointments/models/clinicAppointment.model.js";
import Clinic from "../../modules/clinic/clinic-core/models/clinic.model.js";

import { runWithTenantContext } from "../../common/context/tenantContext.js";
import { ConflictError } from "../../common/utils/errors.js";

// ─── Fixtures ─────────────────────────────────────────────────────────

let clinicId;
let doctorId;
let userId;

const TZ = "Asia/Baku";

// Anchor day, far enough in the future that no other test interferes.
// All times below are spelled as concrete UTC instants so the math is
// completely unambiguous — no local-time gymnastics in this file.
//
//   BASELINE  : 2026-09-07  09:00–10:00 UTC
//
// All "B" intervals below are positioned RELATIVE to that one.

const BASE_START = new Date("2026-09-07T09:00:00.000Z");
const BASE_END = new Date("2026-09-07T10:00:00.000Z");

// Helper — build a Date n minutes after BASE_START.
function at(offsetMinutes) {
  return new Date(BASE_START.getTime() + offsetMinutes * 60 * 1000);
}

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

// Seed a baseline appointment for the doctor: 09:00–10:00 UTC, scheduled.
// All overlap tests probe against this. Returns the saved doc.
async function seedBaseline(overrides = {}) {
  return ClinicAppointment.create({
    clinicId,
    doctorId,
    patientId: new mongoose.Types.ObjectId(),
    startUTC: BASE_START,
    endUTC: BASE_END,
    // Derived fields are required by the model; the values don't matter
    // for conflict detection (it queries on doctorId + startUTC/endUTC
    // + status) but the doc has to be saveable.
    localDate: "2026-09-07",
    startMinute: 13 * 60, // 09:00 Asia/Baku = 13:00 UTC+4 minutes-from-midnight... actually startMinute is LOCAL. Use a sane local value.
    endMinute: 14 * 60,
    status: "scheduled",
    createdBy: {
      actorType: "user",
      actorId: userId,
      role: "owner",
    },
    ...overrides,
  });
}

beforeEach(async () => {
  clinicId = new mongoose.Types.ObjectId();
  doctorId = new mongoose.Types.ObjectId();
  userId = new mongoose.Types.ObjectId();

  await Clinic.collection.deleteMany({});
  await ClinicAppointment.collection.deleteMany({});

  await Clinic.create({
    _id: clinicId,
    name: "Conflict Test Clinic",
    slug: `conflict-test-${clinicId.toString().slice(-8)}`,
    ownerId: userId,
    timezone: TZ,
  });
});

// ════════════════════════════════════════════════════════════════════
//  assertNoConflict — overlap matrix
// ════════════════════════════════════════════════════════════════════

describe("assertNoConflict — Allen-style overlap matrix", () => {
  // ─── Overlap cases (must throw ConflictError) ───────────────────

  it("EQUALS (B.start === A.start, B.end === A.end) → throws", async () => {
    // B = A exactly
    await seedBaseline();
    await expect(
      withCtx(() =>
        assertNoConflict({
          clinicId,
          doctorId,
          startUTC: BASE_START, // 09:00
          endUTC: BASE_END, // 10:00
        }),
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("STARTS (B.start === A.start, B.end < A.end) → throws", async () => {
    // B: 09:00–09:30 — shares the left edge, ends earlier
    await seedBaseline();
    await expect(
      withCtx(() =>
        assertNoConflict({
          clinicId,
          doctorId,
          startUTC: BASE_START,
          endUTC: at(30),
        }),
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("FINISHES (B.start > A.start, B.end === A.end) → throws", async () => {
    // B: 09:30–10:00 — shares the right edge, starts later
    await seedBaseline();
    await expect(
      withCtx(() =>
        assertNoConflict({
          clinicId,
          doctorId,
          startUTC: at(30),
          endUTC: BASE_END,
        }),
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("DURING — B fully INSIDE A → throws", async () => {
    // B: 09:15–09:45 — strict subset of A
    await seedBaseline();
    await expect(
      withCtx(() =>
        assertNoConflict({
          clinicId,
          doctorId,
          startUTC: at(15),
          endUTC: at(45),
        }),
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("CONTAINS — B fully CONTAINS A → throws", async () => {
    // B: 08:00–11:00 — strict superset of A
    await seedBaseline();
    await expect(
      withCtx(() =>
        assertNoConflict({
          clinicId,
          doctorId,
          startUTC: at(-60), // 08:00
          endUTC: at(120), // 11:00
        }),
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("OVERLAPS (B starts before A, ends inside A) → throws", async () => {
    // B: 08:30–09:30 — left-tail bleeds into A
    await seedBaseline();
    await expect(
      withCtx(() =>
        assertNoConflict({
          clinicId,
          doctorId,
          startUTC: at(-30),
          endUTC: at(30),
        }),
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("OVERLAPPED-BY (B starts inside A, ends after A) → throws", async () => {
    // B: 09:30–10:30 — right-tail bleeds past A
    await seedBaseline();
    await expect(
      withCtx(() =>
        assertNoConflict({
          clinicId,
          doctorId,
          startUTC: at(30),
          endUTC: at(90),
        }),
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  // ─── Non-overlap cases (must resolve silently) ──────────────────

  it("MEETS (A.end === B.start, back-to-back) → no throw", async () => {
    // B: 10:00–11:00 — starts exactly when A ends.
    // Overlap rule uses strict inequalities, so this is OK.
    await seedBaseline();
    await expect(
      withCtx(() =>
        assertNoConflict({
          clinicId,
          doctorId,
          startUTC: BASE_END, // 10:00
          endUTC: at(120),
        }),
      ),
    ).resolves.toBeUndefined();
  });

  it("MET-BY (B.end === A.start, back-to-back) → no throw", async () => {
    // B: 08:00–09:00 — ends exactly when A starts.
    await seedBaseline();
    await expect(
      withCtx(() =>
        assertNoConflict({
          clinicId,
          doctorId,
          startUTC: at(-60),
          endUTC: BASE_START,
        }),
      ),
    ).resolves.toBeUndefined();
  });

  it("BEFORE (B entirely earlier than A) → no throw", async () => {
    // B: 07:00–08:00 — strict gap before A.
    await seedBaseline();
    await expect(
      withCtx(() =>
        assertNoConflict({
          clinicId,
          doctorId,
          startUTC: at(-120),
          endUTC: at(-60),
        }),
      ),
    ).resolves.toBeUndefined();
  });

  it("AFTER (B entirely later than A) → no throw", async () => {
    // B: 11:00–12:00 — strict gap after A.
    await seedBaseline();
    await expect(
      withCtx(() =>
        assertNoConflict({
          clinicId,
          doctorId,
          startUTC: at(120),
          endUTC: at(180),
        }),
      ),
    ).resolves.toBeUndefined();
  });

  // ─── Status-aware checks ────────────────────────────────────────

  it("ignores cancelled / completed appointments — overlap with terminal status passes", async () => {
    // Same time slot as A, but A is cancelled. assertNoConflict should
    // not see it as active and must NOT throw.
    await seedBaseline({ status: "cancelled", cancelledAt: new Date() });

    await expect(
      withCtx(() =>
        assertNoConflict({
          clinicId,
          doctorId,
          startUTC: BASE_START,
          endUTC: BASE_END,
        }),
      ),
    ).resolves.toBeUndefined();

    // And a completed one in the same window also must not block:
    await ClinicAppointment.collection.deleteMany({});
    await seedBaseline({
      status: "completed",
      checkedInAt: new Date(),
      completedAt: new Date(),
    });
    await expect(
      withCtx(() =>
        assertNoConflict({
          clinicId,
          doctorId,
          startUTC: BASE_START,
          endUTC: BASE_END,
        }),
      ),
    ).resolves.toBeUndefined();
  });

  // ─── excludeId — reschedule self-skip ───────────────────────────

  it("excludeId lets an appointment skip itself (reschedule path)", async () => {
    // Without excludeId, the EQUALS case throws. With excludeId set to the
    // existing appointment's _id, the same query must pass — that's how
    // rescheduleAppointment avoids self-conflict when "moving" to the
    // same window (or a partly-overlapping window with itself).
    const doc = await seedBaseline();

    // Sanity: without excludeId it throws
    await expect(
      withCtx(() =>
        assertNoConflict({
          clinicId,
          doctorId,
          startUTC: BASE_START,
          endUTC: BASE_END,
        }),
      ),
    ).rejects.toBeInstanceOf(ConflictError);

    // With excludeId it passes
    await expect(
      withCtx(() =>
        assertNoConflict({
          clinicId,
          doctorId,
          startUTC: BASE_START,
          endUTC: BASE_END,
          excludeId: doc._id,
        }),
      ),
    ).resolves.toBeUndefined();
  });
});
