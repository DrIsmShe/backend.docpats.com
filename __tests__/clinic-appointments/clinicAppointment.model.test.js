// server/__tests__/clinic/appointments/clinicAppointment.model.test.js
//
// Schema-level tests for ClinicAppointment.
//
// Scope:
//   - schema basics: required fields, defaults, enum
//   - pre-validate hook: end > start invariants
//   - tenantScopedPlugin: queries auto-filter by current clinicId
//   - softDeletePlugin: isDeleted/deletedAt behave; cancellation is NOT
//     a soft-delete (it's a status — appointments stay queryable after
//     being cancelled)
//   - cross-tenant isolation: one clinic cannot read/update/delete
//     another clinic's appointments through any standard query method
//   - partial index `doctor_active_overlap` is created with the right
//     filter, since the service relies on it for cheap conflict checks
//
// Assumes the project-wide test setup (server/__tests__/setup.js) starts
// a mongodb-memory-server in beforeAll and clears collections between
// tests. We add per-suite teardown for the local Mongoose model only so
// later test files don't see stale docs.
//
// Tenant context: model-level tests run helpers that call
// runWithTenantContext({ clinicId, ... }, fn). See _testContext below.

import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import mongoose from "mongoose";

import ClinicAppointment, {
  APPOINTMENT_STATUSES,
  ACTIVE_STATUSES,
  REASON_MAX_LENGTH,
} from "../../modules/clinic/clinic-appointments/models/clinicAppointment.model.js";

import {
  runWithTenantContext,
  getCurrentClinicId,
} from "../../common/context/tenantContext.js";

// ─── Helpers ──────────────────────────────────────────────────

const FIXED_CLINIC_A = new mongoose.Types.ObjectId();
const FIXED_CLINIC_B = new mongoose.Types.ObjectId();
const FIXED_DOCTOR = new mongoose.Types.ObjectId();
const FIXED_PATIENT = new mongoose.Types.ObjectId();
const FIXED_USER = new mongoose.Types.ObjectId();

/**
 * Run a thunk inside a tenant context. Mirrors how the service is
 * invoked from a request — the AsyncLocalStorage store carries
 * { clinicId, userId, actorType, role } down the call stack so the
 * tenantScoped plugin can auto-attach clinicId to queries.
 */
function withCtx(ctx, fn) {
  return runWithTenantContext(
    {
      clinicId: String(ctx.clinicId),
      userId: String(ctx.userId || FIXED_USER),
      actorType: ctx.actorType || "user",
      role: ctx.role || "owner",
    },
    fn,
  );
}

/**
 * Build a valid raw appointment payload — every required field present,
 * sensible defaults, and a unique time so per-test conflicts are
 * unlikely unless explicitly forced.
 */
function buildAppointmentDoc(overrides = {}) {
  const start = new Date("2026-06-15T05:00:00Z"); // 09:00 Asia/Baku
  const end = new Date("2026-06-15T05:30:00Z"); // 09:30 Asia/Baku
  return {
    clinicId: FIXED_CLINIC_A,
    doctorId: FIXED_DOCTOR,
    patientId: FIXED_PATIENT,
    startUTC: start,
    endUTC: end,
    localDate: "2026-06-15",
    startMinute: 540,
    endMinute: 570,
    status: "scheduled",
    createdBy: {
      actorType: "user",
      actorId: FIXED_USER,
      role: "owner",
    },
    ...overrides,
  };
}

beforeEach(async () => {
  // Setup file does collection-level cleanup, but be explicit on this
  // collection so a flaky shared setup doesn't bleed state between
  // these tests.
  await ClinicAppointment.collection.deleteMany({});
});

// ════════════════════════════════════════════════════════════════
//  BASICS — required fields, defaults, enum
// ════════════════════════════════════════════════════════════════

describe("ClinicAppointment — basics", () => {
  it("creates a doc with all required fields", async () => {
    const doc = await withCtx({ clinicId: FIXED_CLINIC_A }, () =>
      ClinicAppointment.create(buildAppointmentDoc()),
    );
    expect(doc._id).toBeDefined();
    expect(String(doc.clinicId)).toBe(String(FIXED_CLINIC_A));
    expect(doc.status).toBe("scheduled");
    expect(doc.localDate).toBe("2026-06-15");
    expect(doc.startMinute).toBe(540);
    expect(doc.endMinute).toBe(570);
    expect(doc.checkedInAt).toBeNull();
    expect(doc.completedAt).toBeNull();
    expect(doc.cancelledAt).toBeNull();
    expect(doc.noShowAt).toBeNull();
    expect(doc.cancelReason).toBeNull();
    expect(doc.reasonEncrypted).toBeNull();
  });

  it("status defaults to 'scheduled' when not provided", async () => {
    const doc = await withCtx({ clinicId: FIXED_CLINIC_A }, () =>
      ClinicAppointment.create(buildAppointmentDoc({ status: undefined })),
    );
    expect(doc.status).toBe("scheduled");
  });

  it("rejects unknown status values", async () => {
    await expect(
      withCtx({ clinicId: FIXED_CLINIC_A }, () =>
        ClinicAppointment.create(
          buildAppointmentDoc({ status: "definitely_not_a_status" }),
        ),
      ),
    ).rejects.toThrow(/validation/i);
  });

  it("accepts every value from APPOINTMENT_STATUSES", async () => {
    for (const s of APPOINTMENT_STATUSES) {
      const doc = await withCtx({ clinicId: FIXED_CLINIC_A }, () =>
        ClinicAppointment.create(
          buildAppointmentDoc({
            status: s,
            // Spread per-status start times so they don't conflict on
            // the partial index — though no unique index, helps clarity.
            startUTC: new Date("2026-06-15T05:00:00Z"),
            endUTC: new Date("2026-06-15T05:30:00Z"),
          }),
        ),
      );
      expect(doc.status).toBe(s);
      await ClinicAppointment.collection.deleteMany({});
    }
  });

  it("missing required field (doctorId) → ValidationError", async () => {
    const broken = buildAppointmentDoc({ doctorId: undefined });
    await expect(
      withCtx({ clinicId: FIXED_CLINIC_A }, () =>
        ClinicAppointment.create(broken),
      ),
    ).rejects.toThrow(/doctorId/i);
  });

  it("missing required field (startUTC) → ValidationError", async () => {
    const broken = buildAppointmentDoc({ startUTC: undefined });
    await expect(
      withCtx({ clinicId: FIXED_CLINIC_A }, () =>
        ClinicAppointment.create(broken),
      ),
    ).rejects.toThrow();
  });

  it("missing required field (createdBy) → ValidationError", async () => {
    const broken = buildAppointmentDoc({ createdBy: undefined });
    await expect(
      withCtx({ clinicId: FIXED_CLINIC_A }, () =>
        ClinicAppointment.create(broken),
      ),
    ).rejects.toThrow();
  });

  it("createdBy.actorType must be 'user' or 'employee'", async () => {
    const broken = buildAppointmentDoc({
      createdBy: { actorType: "ghost", actorId: FIXED_USER, role: "owner" },
    });
    await expect(
      withCtx({ clinicId: FIXED_CLINIC_A }, () =>
        ClinicAppointment.create(broken),
      ),
    ).rejects.toThrow();
  });

  it("ACTIVE_STATUSES contains exactly scheduled + checked_in", () => {
    expect([...ACTIVE_STATUSES].sort()).toEqual(
      ["checked_in", "scheduled"].sort(),
    );
  });

  it("REASON_MAX_LENGTH is exported and sensible", () => {
    expect(REASON_MAX_LENGTH).toBeGreaterThan(100);
    expect(REASON_MAX_LENGTH).toBeLessThanOrEqual(10000);
  });
});

// ════════════════════════════════════════════════════════════════
//  HOOKS — pre-validate invariants
// ════════════════════════════════════════════════════════════════

describe("ClinicAppointment — pre-validate hook", () => {
  it("rejects endUTC equal to startUTC", async () => {
    const broken = buildAppointmentDoc({
      startUTC: new Date("2026-06-15T05:00:00Z"),
      endUTC: new Date("2026-06-15T05:00:00Z"),
    });
    await expect(
      withCtx({ clinicId: FIXED_CLINIC_A }, () =>
        ClinicAppointment.create(broken),
      ),
    ).rejects.toThrow(/endUTC must be after startUTC/);
  });

  it("rejects endUTC before startUTC", async () => {
    const broken = buildAppointmentDoc({
      startUTC: new Date("2026-06-15T05:30:00Z"),
      endUTC: new Date("2026-06-15T05:00:00Z"),
    });
    await expect(
      withCtx({ clinicId: FIXED_CLINIC_A }, () =>
        ClinicAppointment.create(broken),
      ),
    ).rejects.toThrow(/endUTC must be after startUTC/);
  });

  it("rejects endMinute <= startMinute", async () => {
    const broken = buildAppointmentDoc({
      startMinute: 600,
      endMinute: 600,
    });
    await expect(
      withCtx({ clinicId: FIXED_CLINIC_A }, () =>
        ClinicAppointment.create(broken),
      ),
    ).rejects.toThrow(/endMinute must be after startMinute/);
  });

  it("startMinute out of range (negative) → schema validation fails", async () => {
    const broken = buildAppointmentDoc({ startMinute: -1 });
    await expect(
      withCtx({ clinicId: FIXED_CLINIC_A }, () =>
        ClinicAppointment.create(broken),
      ),
    ).rejects.toThrow();
  });

  it("endMinute capped at 1440", async () => {
    const broken = buildAppointmentDoc({
      startMinute: 1430,
      endMinute: 1450, // > 1440 max
    });
    await expect(
      withCtx({ clinicId: FIXED_CLINIC_A }, () =>
        ClinicAppointment.create(broken),
      ),
    ).rejects.toThrow();
  });
});

// ════════════════════════════════════════════════════════════════
//  PLUGINS — tenantScoped, softDelete
// ════════════════════════════════════════════════════════════════

describe("ClinicAppointment — plugins", () => {
  it("tenantScoped auto-attaches clinicId from context on save", async () => {
    // We don't pass clinicId in the payload — plugin should infer it
    // from the active tenant context.
    const payload = buildAppointmentDoc();
    delete payload.clinicId;

    // Hydrate model so the plugin's pre-save hook runs.
    const doc = await withCtx({ clinicId: FIXED_CLINIC_A }, () =>
      new ClinicAppointment(payload).save(),
    );
    expect(String(doc.clinicId)).toBe(String(FIXED_CLINIC_A));
  });

  it("softDelete plugin sets isDeleted and deletedAt; cancellation does NOT", async () => {
    const doc = await withCtx({ clinicId: FIXED_CLINIC_A }, () =>
      ClinicAppointment.create(buildAppointmentDoc()),
    );

    // Cancelling an appointment is a STATUS change, not a soft delete.
    doc.status = "cancelled";
    doc.cancelledAt = new Date();
    await withCtx({ clinicId: FIXED_CLINIC_A }, () => doc.save());

    const stillThere = await withCtx({ clinicId: FIXED_CLINIC_A }, () =>
      ClinicAppointment.findById(doc._id).lean(),
    );
    expect(stillThere).toBeTruthy();
    expect(stillThere.status).toBe("cancelled");
    expect(stillThere.isDeleted).not.toBe(true);
    expect(stillThere.deletedAt).toBeFalsy();

    // Now perform an actual soft delete via plugin's deleteOne query
    // middleware — should hide the doc from find().
    await withCtx({ clinicId: FIXED_CLINIC_A }, () => doc.deleteOne());

    const afterSoftDelete = await withCtx({ clinicId: FIXED_CLINIC_A }, () =>
      ClinicAppointment.findById(doc._id).lean(),
    );
    // Behaviour of the project's softDelete plugin: queries filter out
    // isDeleted:true by default. So findById returns null.
    expect(afterSoftDelete).toBeNull();
  });
});

// ════════════════════════════════════════════════════════════════
//  ISOLATION — cross-tenant blocking
// ════════════════════════════════════════════════════════════════

describe("ClinicAppointment — cross-tenant isolation", () => {
  it("clinic A cannot find clinic B's appointment via findById", async () => {
    const docB = await withCtx({ clinicId: FIXED_CLINIC_B }, () =>
      ClinicAppointment.create(
        buildAppointmentDoc({ clinicId: FIXED_CLINIC_B }),
      ),
    );

    const found = await withCtx({ clinicId: FIXED_CLINIC_A }, () =>
      ClinicAppointment.findById(docB._id).lean(),
    );
    expect(found).toBeNull();
  });

  it("clinic A's find() never returns clinic B's docs", async () => {
    await withCtx({ clinicId: FIXED_CLINIC_A }, () =>
      ClinicAppointment.create(buildAppointmentDoc()),
    );
    await withCtx({ clinicId: FIXED_CLINIC_B }, () =>
      ClinicAppointment.create(
        buildAppointmentDoc({ clinicId: FIXED_CLINIC_B }),
      ),
    );

    const a = await withCtx({ clinicId: FIXED_CLINIC_A }, () =>
      ClinicAppointment.find({}).lean(),
    );
    expect(a).toHaveLength(1);
    expect(String(a[0].clinicId)).toBe(String(FIXED_CLINIC_A));

    const b = await withCtx({ clinicId: FIXED_CLINIC_B }, () =>
      ClinicAppointment.find({}).lean(),
    );
    expect(b).toHaveLength(1);
    expect(String(b[0].clinicId)).toBe(String(FIXED_CLINIC_B));
  });

  it("clinic A cannot updateOne clinic B's appointment", async () => {
    const docB = await withCtx({ clinicId: FIXED_CLINIC_B }, () =>
      ClinicAppointment.create(
        buildAppointmentDoc({ clinicId: FIXED_CLINIC_B }),
      ),
    );

    // Try to flip status from clinic A's context — plugin should
    // narrow the filter so no document matches.
    const result = await withCtx({ clinicId: FIXED_CLINIC_A }, () =>
      ClinicAppointment.updateOne(
        { _id: docB._id },
        { $set: { status: "cancelled" } },
      ),
    );
    expect(result.matchedCount).toBe(0);

    // Verify clinic B's doc untouched.
    const stillScheduled = await withCtx({ clinicId: FIXED_CLINIC_B }, () =>
      ClinicAppointment.findById(docB._id).lean(),
    );
    expect(stillScheduled.status).toBe("scheduled");
  });

  it("clinic A cannot deleteOne clinic B's appointment", async () => {
    const docB = await withCtx({ clinicId: FIXED_CLINIC_B }, () =>
      ClinicAppointment.create(
        buildAppointmentDoc({ clinicId: FIXED_CLINIC_B }),
      ),
    );

    const result = await withCtx({ clinicId: FIXED_CLINIC_A }, () =>
      ClinicAppointment.deleteOne({ _id: docB._id }),
    );
    expect(result.deletedCount).toBe(0);

    const stillThere = await withCtx({ clinicId: FIXED_CLINIC_B }, () =>
      ClinicAppointment.findById(docB._id).lean(),
    );
    expect(stillThere).toBeTruthy();
  });

  it("parallel queries from two contexts don't leak (Promise.all)", async () => {
    await Promise.all([
      withCtx({ clinicId: FIXED_CLINIC_A }, () =>
        ClinicAppointment.create(buildAppointmentDoc()),
      ),
      withCtx({ clinicId: FIXED_CLINIC_B }, () =>
        ClinicAppointment.create(
          buildAppointmentDoc({ clinicId: FIXED_CLINIC_B }),
        ),
      ),
    ]);

    const [resA, resB] = await Promise.all([
      withCtx({ clinicId: FIXED_CLINIC_A }, () =>
        ClinicAppointment.find({}).lean(),
      ),
      withCtx({ clinicId: FIXED_CLINIC_B }, () =>
        ClinicAppointment.find({}).lean(),
      ),
    ]);
    expect(resA).toHaveLength(1);
    expect(resB).toHaveLength(1);
    expect(String(resA[0].clinicId)).toBe(String(FIXED_CLINIC_A));
    expect(String(resB[0].clinicId)).toBe(String(FIXED_CLINIC_B));
  });
});

// ════════════════════════════════════════════════════════════════
//  INDEXES — verify the partial index used for conflict detection
// ════════════════════════════════════════════════════════════════

describe("ClinicAppointment — indexes", () => {
  it("declares the partial index doctor_active_overlap", async () => {
    // Ensure indexes are built (memory-server may lag behind schema).
    await ClinicAppointment.syncIndexes();
    const indexes = await ClinicAppointment.collection.indexes();

    const overlap = indexes.find((idx) => idx.name === "doctor_active_overlap");
    expect(overlap).toBeTruthy();

    // Partial filter must restrict to active statuses, otherwise the
    // conflict query in the service won't be served by the index.
    expect(overlap.partialFilterExpression).toBeTruthy();
    expect(overlap.partialFilterExpression.status.$in.sort()).toEqual(
      ["checked_in", "scheduled"].sort(),
    );

    // Key shape should at least cover clinicId + doctorId + startUTC.
    expect(overlap.key).toMatchObject({
      clinicId: 1,
      doctorId: 1,
      startUTC: 1,
    });
  });

  it("declares the doctor day-view compound index", async () => {
    await ClinicAppointment.syncIndexes();
    const indexes = await ClinicAppointment.collection.indexes();
    const hit = indexes.find(
      (idx) =>
        idx.key &&
        idx.key.clinicId === 1 &&
        idx.key.doctorId === 1 &&
        idx.key.localDate === 1,
    );
    expect(hit).toBeTruthy();
  });

  it("declares the patient-history index", async () => {
    await ClinicAppointment.syncIndexes();
    const indexes = await ClinicAppointment.collection.indexes();
    const hit = indexes.find(
      (idx) =>
        idx.key &&
        idx.key.clinicId === 1 &&
        idx.key.patientId === 1 &&
        idx.key.startUTC === -1,
    );
    expect(hit).toBeTruthy();
  });
});

afterAll(async () => {
  // Best-effort cleanup — global setup handles mongoose disconnect,
  // but if this file ran in isolation we want a tidy exit.
  if (mongoose.connection.readyState === 1) {
    await ClinicAppointment.collection.deleteMany({}).catch(() => {});
  }
});
