// server/__tests__/clinic-appointments/appointment.service.test.js
//
// Service-level tests for clinic-appointments — the orchestration layer
// between the controllers and the model. Tests run against a real
// in-process mongodb-memory-server (via the project setup file) with
// real Mongoose models, real plugins, real encryption.
//
// Scope:
//   createAppointment   — happy path, role gate, doctor/patient existence,
//                         conflict detection, PHI encryption, audit fields
//   getAppointment      — read + decrypt + tenant isolation + 404
//   listAppointments    — doctor mode (window→UTC) + patient mode (cursor)
//   rescheduleAppointment — active-only gate, conflict with self-exclusion
//   updateAppointmentReason — works on terminal statuses too
//   changeAppointmentStatus — full FSM matrix + role-aware gates
//
// Skipped here, covered in stages 6.4 / 6.5:
//   getBookableSlots — depends on Clinic.timezone + slot computation
//   computeSlots     — own file in 6.4
//   exhaustive overlap matrix — own file in 6.5
//
// Fixtures (rebuilt in beforeEach so tests don't share state):
//   clinicId       — fake ObjectId (no Clinic doc needed for non-slot APIs)
//   doctor user    — ClinicMembership { actorType:"user", role:"doctor" }
//   owner user     — ClinicMembership { actorType:"user", role:"owner" }
//   doctor 2       — second doctor for "not yours" tests
//   patient        — ClinicPatient with encrypted name fields
//
// Every test runs inside runWithTenantContext so the tenantScoped plugin
// can auto-filter clinicId. The acting role is configurable per-call via
// the actAs() helper.

import { describe, it, expect, beforeEach } from "vitest";
import mongoose from "mongoose";

import {
  createAppointment,
  getAppointment,
  listAppointments,
  rescheduleAppointment,
  updateAppointmentReason,
  changeAppointmentStatus,
} from "../../modules/clinic/clinic-appointments/services/appointment.service.js";

import ClinicAppointment, {
  APPOINTMENT_STATUSES,
} from "../../modules/clinic/clinic-appointments/models/clinicAppointment.model.js";

import ClinicMembership from "../../modules/clinic/clinic-staff/models/clinicMembership.model.js";

import Clinic from "../../modules/clinic/clinic-core/models/clinic.model.js";

import { runWithTenantContext } from "../../common/context/tenantContext.js";

import {
  ValidationError,
  NotFoundError,
  ForbiddenError,
  ConflictError,
} from "../../common/utils/errors.js";

// ─── ClinicPatient resolution ──────────────────────────────────
//
// We import dynamically inside the suite so the file isn't aborted if the
// path differs slightly — the first test will fail loudly, but the rest of
// the codebase keeps loading. Static import would crash the whole suite.

import ClinicPatient, {
  encryptValue,
} from "../../modules/clinic/clinic-patients/models/clinicPatient.model.js";

// ─── Fixture state (rebuilt per test) ──────────────────────────

let clinicId;
let otherClinicId;
let doctorId;
let doctor2Id;
let ownerId;
let receptionistId;
let patientId;

/**
 * Run a thunk inside a tenant context for a specific actor.
 * Defaults to the owner — change `role` to test write-permission gates.
 */
function actAs(role, fn, { clinic = clinicId, userId = ownerId } = {}) {
  return runWithTenantContext(
    {
      clinicId: String(clinic),
      userId: String(userId),
      actorType: "user",
      role,
    },
    fn,
  );
}

// ─── Date helpers ──────────────────────────────────────────────

const FAR_FUTURE_DATE = "2026-08-17"; // a Monday
const FAR_FUTURE_DATE_2 = "2026-08-18"; // Tuesday

function isoAt(date, hh, mm = 0) {
  // Build a UTC Date at HH:mm on the given YYYY-MM-DD.
  // The service expects Date instances (already coerced by the validator
  // in real flow); these unit tests bypass the validator and call the
  // service directly, so we hand it the same type the validator would.
  return new Date(
    `${date}T${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:00.000Z`,
  );
}

// ─── Test setup ────────────────────────────────────────────────

beforeEach(async () => {
  // Fresh IDs every test so leaked state from an earlier test doesn't
  // resurrect false matches.
  clinicId = new mongoose.Types.ObjectId();
  otherClinicId = new mongoose.Types.ObjectId();
  doctorId = new mongoose.Types.ObjectId();
  doctor2Id = new mongoose.Types.ObjectId();
  ownerId = new mongoose.Types.ObjectId();
  receptionistId = new mongoose.Types.ObjectId();

  // Clean collections (global setup does this too, but explicit is safe).
  await ClinicAppointment.collection.deleteMany({});
  await ClinicMembership.collection.deleteMany({});
  await ClinicPatient.collection.deleteMany({});
  await Clinic.collection.deleteMany({});

  // ─── Clinics ───
  // The service's resolveClinicTimezone() reads Clinic.timezone, so we
  // need real Clinic docs for both tenant ids — otherwise EVERY appointment
  // create/read throws NotFoundError("Clinic").
  //
  // Slug must be unique across all clinics; generate per-test deterministically.
  await Clinic.create({
    _id: clinicId,
    name: "Test Clinic A",
    slug: `test-clinic-a-${clinicId.toString().slice(-8)}`,
    ownerId,
    timezone: "Asia/Baku",
  });
  await Clinic.create({
    _id: otherClinicId,
    name: "Test Clinic B",
    slug: `test-clinic-b-${otherClinicId.toString().slice(-8)}`,
    ownerId,
    timezone: "Asia/Baku",
  });

  // Owner membership in our clinic
  await ClinicMembership.create({
    userId: ownerId,
    clinicId,
    role: "owner",
    actorType: "user",
    isPrimary: true,
    isActive: true,
    joinedAt: new Date(),
  });

  // Doctor 1 — active in our clinic
  await ClinicMembership.create({
    userId: doctorId,
    clinicId,
    role: "doctor",
    actorType: "user",
    isActive: true,
    joinedAt: new Date(),
  });

  // Doctor 2 — also active in our clinic (used for "different doctor"
  // tests where we want a non-conflicting parallel booking)
  await ClinicMembership.create({
    userId: doctor2Id,
    clinicId,
    role: "doctor",
    actorType: "user",
    isActive: true,
    joinedAt: new Date(),
  });

  // Receptionist
  await ClinicMembership.create({
    userId: receptionistId,
    clinicId,
    role: "receptionist",
    actorType: "user",
    isActive: true,
    joinedAt: new Date(),
  });

  // Patient — ClinicPatient has no pre-save hook for encryption;
  // we encrypt the PHI fields ourselves using the exported helper.
  const patient = await actAs("owner", () =>
    new ClinicPatient({
      clinicId,
      firstNameEncrypted: encryptValue("Ivan"),
      lastNameEncrypted: encryptValue("Testov"),
      phoneEncrypted: encryptValue("+994501234567"),
      createdBy: ownerId,
      createdByType: "user",
    }).save(),
  );
  patientId = patient._id;
});

// ─── Helper: build a create payload that should succeed ────────

function validCreatePayload(overrides = {}) {
  return {
    doctorId: String(doctorId),
    patientId: String(patientId),
    startUTC: isoAt(FAR_FUTURE_DATE, 9, 0),
    endUTC: isoAt(FAR_FUTURE_DATE, 9, 30),
    reason: "consultation",
    ...overrides,
  };
}

// ════════════════════════════════════════════════════════════════
//  createAppointment
// ════════════════════════════════════════════════════════════════

describe("createAppointment — happy paths", () => {
  it("creates a scheduled appointment with all derived fields", async () => {
    const dto = await actAs("owner", () =>
      createAppointment(validCreatePayload()),
    );
    expect(dto.id).toBeDefined();
    expect(dto.status).toBe("scheduled");
    expect(dto.localDate).toBeDefined();
    expect(typeof dto.startMinute).toBe("number");
    expect(typeof dto.endMinute).toBe("number");
    expect(dto.endMinute).toBeGreaterThan(dto.startMinute);
    expect(dto.reason).toBe("consultation");
    expect(dto.createdBy).toMatchObject({
      actorType: "user",
      role: "owner",
    });
    expect(String(dto.createdBy.actorId)).toBe(String(ownerId));
  });

  it("encrypts the reason at rest (DB has reasonEncrypted, not reason)", async () => {
    await actAs("owner", () => createAppointment(validCreatePayload()));
    const raw = await ClinicAppointment.collection.findOne({});
    // Raw doc has the encrypted blob, not the plaintext reason.
    expect(raw.reasonEncrypted).toBeDefined();
    expect(raw.reasonEncrypted).toMatch(/^[a-f0-9]+:[a-f0-9]+:[a-f0-9]+$/);
    expect(raw.reason).toBeUndefined();
  });

  it("DTO decrypts reason back transparently", async () => {
    const dto = await actAs("owner", () =>
      createAppointment(validCreatePayload({ reason: "headache + dizziness" })),
    );
    expect(dto.reason).toBe("headache + dizziness");
  });

  it("creates without a reason (reason: null in DTO, no encryption blob)", async () => {
    const dto = await actAs("owner", () =>
      createAppointment(validCreatePayload({ reason: undefined })),
    );
    expect(dto.reason).toBeNull();
    const raw = await ClinicAppointment.collection.findOne({});
    expect(raw.reasonEncrypted).toBeFalsy();
  });

  it("admin can create an appointment", async () => {
    // Admin needs a membership too — add inline.
    const adminId = new mongoose.Types.ObjectId();
    await ClinicMembership.create({
      userId: adminId,
      clinicId,
      role: "admin",
      actorType: "user",
      isActive: true,
    });
    const dto = await actAs(
      "admin",
      () => createAppointment(validCreatePayload()),
      { userId: adminId },
    );
    expect(dto.status).toBe("scheduled");
  });

  it("receptionist can create an appointment", async () => {
    const dto = await actAs(
      "receptionist",
      () => createAppointment(validCreatePayload()),
      { userId: receptionistId },
    );
    expect(dto.status).toBe("scheduled");
  });
});

describe("createAppointment — role gate", () => {
  it("doctor cannot create an appointment (ForbiddenError)", async () => {
    await expect(
      actAs("doctor", () => createAppointment(validCreatePayload()), {
        userId: doctorId,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("nurse cannot create an appointment", async () => {
    const nurseId = new mongoose.Types.ObjectId();
    await ClinicMembership.create({
      userId: nurseId,
      clinicId,
      role: "nurse",
      actorType: "user",
      isActive: true,
    });
    await expect(
      actAs("nurse", () => createAppointment(validCreatePayload()), {
        userId: nurseId,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("manager cannot create an appointment", async () => {
    const managerId = new mongoose.Types.ObjectId();
    await ClinicMembership.create({
      userId: managerId,
      clinicId,
      role: "manager",
      actorType: "user",
      isActive: true,
    });
    await expect(
      actAs("manager", () => createAppointment(validCreatePayload()), {
        userId: managerId,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe("createAppointment — doctor / patient existence", () => {
  it("rejects if doctorId is not a member of this clinic", async () => {
    const ghostDoctor = new mongoose.Types.ObjectId();
    await expect(
      actAs("owner", () =>
        createAppointment(
          validCreatePayload({ doctorId: String(ghostDoctor) }),
        ),
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("rejects if doctorId's membership is inactive", async () => {
    const inactiveDoctorId = new mongoose.Types.ObjectId();
    await ClinicMembership.create({
      userId: inactiveDoctorId,
      clinicId,
      role: "doctor",
      actorType: "user",
      isActive: false,
      leftAt: new Date(),
    });
    await expect(
      actAs("owner", () =>
        createAppointment(
          validCreatePayload({ doctorId: String(inactiveDoctorId) }),
        ),
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("rejects if membership exists but with non-doctor role", async () => {
    // Receptionist has a membership but is NOT a doctor — service throws
    // ForbiddenError ("Member with role 'receptionist' is not a doctor"),
    // not NotFoundError (which is reserved for missing membership entirely).
    await expect(
      actAs("owner", () =>
        createAppointment(
          validCreatePayload({ doctorId: String(receptionistId) }),
        ),
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it("rejects if patientId doesn't exist", async () => {
    const ghostPatient = new mongoose.Types.ObjectId();
    await expect(
      actAs("owner", () =>
        createAppointment(
          validCreatePayload({ patientId: String(ghostPatient) }),
        ),
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("rejects if patient belongs to another clinic", async () => {
    const otherPatient = await runWithTenantContext(
      {
        clinicId: String(otherClinicId),
        userId: String(ownerId),
        actorType: "user",
        role: "owner",
      },
      () =>
        new ClinicPatient({
          clinicId: otherClinicId,
          firstNameEncrypted: encryptValue("Other"),
          lastNameEncrypted: encryptValue("Clinic"),
          createdBy: ownerId,
          createdByType: "user",
        }).save(),
    );

    await expect(
      actAs("owner", () =>
        createAppointment(
          validCreatePayload({ patientId: String(otherPatient._id) }),
        ),
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("createAppointment — conflict detection", () => {
  it("rejects an exact-overlap second booking on the same doctor", async () => {
    await actAs("owner", () => createAppointment(validCreatePayload()));
    await expect(
      actAs("owner", () => createAppointment(validCreatePayload())),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("rejects a partial-overlap booking (later start, overlaps end)", async () => {
    await actAs("owner", () => createAppointment(validCreatePayload()));
    await expect(
      actAs("owner", () =>
        createAppointment(
          validCreatePayload({
            startUTC: isoAt(FAR_FUTURE_DATE, 9, 15),
            endUTC: isoAt(FAR_FUTURE_DATE, 9, 45),
          }),
        ),
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("rejects a containing booking (entirely covers existing)", async () => {
    await actAs("owner", () => createAppointment(validCreatePayload()));
    await expect(
      actAs("owner", () =>
        createAppointment(
          validCreatePayload({
            startUTC: isoAt(FAR_FUTURE_DATE, 8, 0),
            endUTC: isoAt(FAR_FUTURE_DATE, 11, 0),
          }),
        ),
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("allows back-to-back booking (end of A === start of B)", async () => {
    await actAs("owner", () => createAppointment(validCreatePayload()));
    const dto = await actAs("owner", () =>
      createAppointment(
        validCreatePayload({
          startUTC: isoAt(FAR_FUTURE_DATE, 9, 30),
          endUTC: isoAt(FAR_FUTURE_DATE, 10, 0),
        }),
      ),
    );
    expect(dto.status).toBe("scheduled");
  });

  it("conflict check does NOT consider cancelled appointments as active", async () => {
    const first = await actAs("owner", () =>
      createAppointment(validCreatePayload()),
    );
    await actAs("owner", () =>
      changeAppointmentStatus(first.id, { status: "cancelled" }),
    );

    // Same time slot should now be free.
    const second = await actAs("owner", () =>
      createAppointment(validCreatePayload()),
    );
    expect(second.id).toBeDefined();
    expect(second.id).not.toBe(first.id);
  });

  it("conflict check does NOT consider completed appointments as active", async () => {
    const first = await actAs("owner", () =>
      createAppointment(validCreatePayload()),
    );
    await actAs("owner", () =>
      changeAppointmentStatus(first.id, { status: "checked_in" }),
    );
    await actAs("owner", () =>
      changeAppointmentStatus(first.id, { status: "completed" }),
    );

    const second = await actAs("owner", () =>
      createAppointment(validCreatePayload()),
    );
    expect(second.id).toBeDefined();
  });

  it("conflict is scoped per-doctor (doctor2 can have overlap with doctor1)", async () => {
    await actAs("owner", () => createAppointment(validCreatePayload()));
    const second = await actAs("owner", () =>
      createAppointment(validCreatePayload({ doctorId: String(doctor2Id) })),
    );
    expect(second.id).toBeDefined();
  });

  it("conflict is scoped per-clinic (other clinic doesn't see ours)", async () => {
    await actAs("owner", () => createAppointment(validCreatePayload()));

    // Set up another clinic with its own doctor + patient + owner
    const otherDoctorId = new mongoose.Types.ObjectId();
    const otherOwnerId = new mongoose.Types.ObjectId();
    await ClinicMembership.create({
      userId: otherDoctorId,
      clinicId: otherClinicId,
      role: "doctor",
      actorType: "user",
      isActive: true,
    });
    await ClinicMembership.create({
      userId: otherOwnerId,
      clinicId: otherClinicId,
      role: "owner",
      actorType: "user",
      isActive: true,
    });
    const otherPatient = await runWithTenantContext(
      {
        clinicId: String(otherClinicId),
        userId: String(otherOwnerId),
        actorType: "user",
        role: "owner",
      },
      () =>
        new ClinicPatient({
          clinicId: otherClinicId,
          firstNameEncrypted: encryptValue("X"),
          lastNameEncrypted: encryptValue("Y"),
          createdBy: otherOwnerId,
          createdByType: "user",
        }).save(),
    );

    // Same UTC window, but other clinic → must succeed.
    const dto = await runWithTenantContext(
      {
        clinicId: String(otherClinicId),
        userId: String(otherOwnerId),
        actorType: "user",
        role: "owner",
      },
      () =>
        createAppointment({
          doctorId: String(otherDoctorId),
          patientId: String(otherPatient._id),
          startUTC: isoAt(FAR_FUTURE_DATE, 9, 0),
          endUTC: isoAt(FAR_FUTURE_DATE, 9, 30),
        }),
    );
    expect(dto.status).toBe("scheduled");
  });
});

// ════════════════════════════════════════════════════════════════
//  getAppointment
// ════════════════════════════════════════════════════════════════

describe("getAppointment", () => {
  it("returns a decrypted DTO for an existing appointment", async () => {
    const created = await actAs("owner", () =>
      createAppointment(validCreatePayload({ reason: "fever 38.5" })),
    );
    const fetched = await actAs("owner", () => getAppointment(created.id));
    expect(fetched.id).toBe(created.id);
    expect(fetched.reason).toBe("fever 38.5");
  });

  it("throws NotFoundError for unknown id", async () => {
    const ghost = new mongoose.Types.ObjectId();
    await expect(
      actAs("owner", () => getAppointment(String(ghost))),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("throws NotFoundError when accessed from a different clinic", async () => {
    const created = await actAs("owner", () =>
      createAppointment(validCreatePayload()),
    );
    // Try to read from another clinic's context
    await expect(
      runWithTenantContext(
        {
          clinicId: String(otherClinicId),
          userId: String(ownerId),
          actorType: "user",
          role: "owner",
        },
        () => getAppointment(created.id),
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("any clinic role can read (doctor / receptionist / owner)", async () => {
    const created = await actAs("owner", () =>
      createAppointment(validCreatePayload()),
    );

    const asDoctor = await actAs("doctor", () => getAppointment(created.id), {
      userId: doctorId,
    });
    expect(asDoctor.id).toBe(created.id);

    const asRec = await actAs(
      "receptionist",
      () => getAppointment(created.id),
      { userId: receptionistId },
    );
    expect(asRec.id).toBe(created.id);
  });
});

// ════════════════════════════════════════════════════════════════
//  rescheduleAppointment
// ════════════════════════════════════════════════════════════════

describe("rescheduleAppointment", () => {
  it("moves an appointment to a new time", async () => {
    const created = await actAs("owner", () =>
      createAppointment(validCreatePayload()),
    );
    const moved = await actAs("owner", () =>
      rescheduleAppointment(created.id, {
        startUTC: isoAt(FAR_FUTURE_DATE, 14, 0),
        endUTC: isoAt(FAR_FUTURE_DATE, 14, 30),
      }),
    );
    expect(moved.id).toBe(created.id);
    expect(moved.startMinute).not.toBe(created.startMinute);
  });

  it("conflict check excludes the appointment being rescheduled", async () => {
    // Create at 09:00 → reschedule to 09:15 (overlap with itself, but
    // self-exclusion should let it through).
    const created = await actAs("owner", () =>
      createAppointment(validCreatePayload()),
    );
    const moved = await actAs("owner", () =>
      rescheduleAppointment(created.id, {
        startUTC: isoAt(FAR_FUTURE_DATE, 9, 15),
        endUTC: isoAt(FAR_FUTURE_DATE, 9, 45),
      }),
    );
    expect(moved.id).toBe(created.id);
  });

  it("rejects move into another active appointment's window", async () => {
    const a = await actAs("owner", () =>
      createAppointment(validCreatePayload()),
    );
    const b = await actAs("owner", () =>
      createAppointment(
        validCreatePayload({
          startUTC: isoAt(FAR_FUTURE_DATE, 10, 0),
          endUTC: isoAt(FAR_FUTURE_DATE, 10, 30),
        }),
      ),
    );
    expect(b.id).not.toBe(a.id);
    // Try to move A into B's slot.
    await expect(
      actAs("owner", () =>
        rescheduleAppointment(a.id, {
          startUTC: isoAt(FAR_FUTURE_DATE, 10, 0),
          endUTC: isoAt(FAR_FUTURE_DATE, 10, 30),
        }),
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("cannot reschedule a completed appointment", async () => {
    const created = await actAs("owner", () =>
      createAppointment(validCreatePayload()),
    );
    await actAs("owner", () =>
      changeAppointmentStatus(created.id, { status: "checked_in" }),
    );
    await actAs("owner", () =>
      changeAppointmentStatus(created.id, { status: "completed" }),
    );
    await expect(
      actAs("owner", () =>
        rescheduleAppointment(created.id, {
          startUTC: isoAt(FAR_FUTURE_DATE, 14, 0),
          endUTC: isoAt(FAR_FUTURE_DATE, 14, 30),
        }),
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("cannot reschedule a cancelled appointment", async () => {
    const created = await actAs("owner", () =>
      createAppointment(validCreatePayload()),
    );
    await actAs("owner", () =>
      changeAppointmentStatus(created.id, { status: "cancelled" }),
    );
    await expect(
      actAs("owner", () =>
        rescheduleAppointment(created.id, {
          startUTC: isoAt(FAR_FUTURE_DATE, 14, 0),
          endUTC: isoAt(FAR_FUTURE_DATE, 14, 30),
        }),
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("doctor cannot reschedule", async () => {
    const created = await actAs("owner", () =>
      createAppointment(validCreatePayload()),
    );
    await expect(
      actAs(
        "doctor",
        () =>
          rescheduleAppointment(created.id, {
            startUTC: isoAt(FAR_FUTURE_DATE, 14, 0),
            endUTC: isoAt(FAR_FUTURE_DATE, 14, 30),
          }),
        { userId: doctorId },
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

// ════════════════════════════════════════════════════════════════
//  updateAppointmentReason
// ════════════════════════════════════════════════════════════════

describe("updateAppointmentReason", () => {
  it("updates reason on a scheduled appointment", async () => {
    const created = await actAs("owner", () =>
      createAppointment(validCreatePayload({ reason: "initial" })),
    );
    const updated = await actAs("owner", () =>
      updateAppointmentReason(created.id, { reason: "revised" }),
    );
    expect(updated.reason).toBe("revised");
  });

  it("works on a completed appointment (terminal status)", async () => {
    const created = await actAs("owner", () =>
      createAppointment(validCreatePayload({ reason: "consultation" })),
    );
    await actAs("owner", () =>
      changeAppointmentStatus(created.id, { status: "checked_in" }),
    );
    await actAs("owner", () =>
      changeAppointmentStatus(created.id, { status: "completed" }),
    );
    const updated = await actAs("owner", () =>
      updateAppointmentReason(created.id, {
        reason: "clarified: ENT, no findings",
      }),
    );
    expect(updated.status).toBe("completed");
    expect(updated.reason).toBe("clarified: ENT, no findings");
  });

  it("can clear the reason (sets to null)", async () => {
    const created = await actAs("owner", () =>
      createAppointment(validCreatePayload({ reason: "initial" })),
    );
    const updated = await actAs("owner", () =>
      updateAppointmentReason(created.id, { reason: null }),
    );
    expect(updated.reason).toBeNull();
  });

  it("doctor cannot update reason", async () => {
    const created = await actAs("owner", () =>
      createAppointment(validCreatePayload()),
    );
    await expect(
      actAs(
        "doctor",
        () => updateAppointmentReason(created.id, { reason: "x" }),
        { userId: doctorId },
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

// ════════════════════════════════════════════════════════════════
//  changeAppointmentStatus — FSM matrix
// ════════════════════════════════════════════════════════════════

describe("changeAppointmentStatus — legal transitions", () => {
  it("scheduled → checked_in sets checkedInAt", async () => {
    const created = await actAs("owner", () =>
      createAppointment(validCreatePayload()),
    );
    const updated = await actAs("owner", () =>
      changeAppointmentStatus(created.id, { status: "checked_in" }),
    );
    expect(updated.status).toBe("checked_in");
    expect(updated.checkedInAt).toBeDefined();
  });

  it("checked_in → completed sets completedAt, keeps checkedInAt", async () => {
    const created = await actAs("owner", () =>
      createAppointment(validCreatePayload()),
    );
    const a = await actAs("owner", () =>
      changeAppointmentStatus(created.id, { status: "checked_in" }),
    );
    const b = await actAs("owner", () =>
      changeAppointmentStatus(created.id, { status: "completed" }),
    );
    expect(b.status).toBe("completed");
    expect(b.completedAt).toBeDefined();
    // checkedInAt should still be present
    expect(b.checkedInAt).toEqual(a.checkedInAt);
  });

  it("scheduled → cancelled sets cancelledAt", async () => {
    const created = await actAs("owner", () =>
      createAppointment(validCreatePayload()),
    );
    const cancelled = await actAs("owner", () =>
      changeAppointmentStatus(created.id, {
        status: "cancelled",
        cancelReason: "patient called",
      }),
    );
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.cancelledAt).toBeDefined();
    expect(cancelled.cancelReason).toBe("patient called");
  });

  it("scheduled → no_show sets noShowAt", async () => {
    const created = await actAs("owner", () =>
      createAppointment(validCreatePayload()),
    );
    const noShow = await actAs("owner", () =>
      changeAppointmentStatus(created.id, { status: "no_show" }),
    );
    expect(noShow.status).toBe("no_show");
    expect(noShow.noShowAt).toBeDefined();
  });

  it("checked_in → no_show is legal", async () => {
    const created = await actAs("owner", () =>
      createAppointment(validCreatePayload()),
    );
    await actAs("owner", () =>
      changeAppointmentStatus(created.id, { status: "checked_in" }),
    );
    const noShow = await actAs("owner", () =>
      changeAppointmentStatus(created.id, { status: "no_show" }),
    );
    expect(noShow.status).toBe("no_show");
  });
});

describe("changeAppointmentStatus — illegal transitions", () => {
  it("scheduled → completed is rejected (must check in first)", async () => {
    const created = await actAs("owner", () =>
      createAppointment(validCreatePayload()),
    );
    await expect(
      actAs("owner", () =>
        changeAppointmentStatus(created.id, { status: "completed" }),
      ),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it("completed → anything is rejected", async () => {
    const created = await actAs("owner", () =>
      createAppointment(validCreatePayload()),
    );
    await actAs("owner", () =>
      changeAppointmentStatus(created.id, { status: "checked_in" }),
    );
    await actAs("owner", () =>
      changeAppointmentStatus(created.id, { status: "completed" }),
    );
    for (const s of ["checked_in", "cancelled", "no_show", "completed"]) {
      await expect(
        actAs("owner", () =>
          changeAppointmentStatus(created.id, { status: s }),
        ),
      ).rejects.toBeInstanceOf(ConflictError);
    }
  });

  it("cancelled → anything is rejected", async () => {
    const created = await actAs("owner", () =>
      createAppointment(validCreatePayload()),
    );
    await actAs("owner", () =>
      changeAppointmentStatus(created.id, { status: "cancelled" }),
    );
    for (const s of ["scheduled", "checked_in", "completed", "no_show"]) {
      await expect(
        actAs("owner", () =>
          changeAppointmentStatus(created.id, { status: s }),
        ),
      ).rejects.toBeInstanceOf(Error);
    }
  });
});

describe("changeAppointmentStatus — role gate", () => {
  it("doctor CAN check_in their own appointment", async () => {
    const created = await actAs("owner", () =>
      createAppointment(validCreatePayload()),
    );
    const updated = await actAs(
      "doctor",
      () => changeAppointmentStatus(created.id, { status: "checked_in" }),
      { userId: doctorId },
    );
    expect(updated.status).toBe("checked_in");
  });

  it("doctor CAN complete their own appointment after check_in", async () => {
    const created = await actAs("owner", () =>
      createAppointment(validCreatePayload()),
    );
    await actAs(
      "doctor",
      () => changeAppointmentStatus(created.id, { status: "checked_in" }),
      { userId: doctorId },
    );
    const completed = await actAs(
      "doctor",
      () => changeAppointmentStatus(created.id, { status: "completed" }),
      { userId: doctorId },
    );
    expect(completed.status).toBe("completed");
  });

  it("doctor CANNOT change status on another doctor's appointment", async () => {
    const created = await actAs("owner", () =>
      createAppointment(validCreatePayload()),
    );
    // doctor2 is a different doctor — they shouldn't touch this
    await expect(
      actAs(
        "doctor",
        () => changeAppointmentStatus(created.id, { status: "checked_in" }),
        { userId: doctor2Id },
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

// ════════════════════════════════════════════════════════════════
//  listAppointments — doctor mode
// ════════════════════════════════════════════════════════════════

describe("listAppointments — doctor mode", () => {
  it("returns appointments for a doctor on a date range", async () => {
    await actAs("owner", () =>
      createAppointment(
        validCreatePayload({
          startUTC: isoAt(FAR_FUTURE_DATE, 9, 0),
          endUTC: isoAt(FAR_FUTURE_DATE, 9, 30),
        }),
      ),
    );
    await actAs("owner", () =>
      createAppointment(
        validCreatePayload({
          startUTC: isoAt(FAR_FUTURE_DATE, 10, 0),
          endUTC: isoAt(FAR_FUTURE_DATE, 10, 30),
        }),
      ),
    );

    const res = await actAs("owner", () =>
      listAppointments({
        doctorId: String(doctorId),
        from: FAR_FUTURE_DATE,
        to: FAR_FUTURE_DATE,
      }),
    );
    expect(res.count).toBe(2);
    expect(res.items).toHaveLength(2);
  });

  it("results are sorted by startUTC ascending", async () => {
    await actAs("owner", () =>
      createAppointment(
        validCreatePayload({
          startUTC: isoAt(FAR_FUTURE_DATE, 14, 0),
          endUTC: isoAt(FAR_FUTURE_DATE, 14, 30),
        }),
      ),
    );
    await actAs("owner", () =>
      createAppointment(
        validCreatePayload({
          startUTC: isoAt(FAR_FUTURE_DATE, 9, 0),
          endUTC: isoAt(FAR_FUTURE_DATE, 9, 30),
        }),
      ),
    );

    const res = await actAs("owner", () =>
      listAppointments({
        doctorId: String(doctorId),
        from: FAR_FUTURE_DATE,
        to: FAR_FUTURE_DATE,
      }),
    );
    expect(res.items[0].startMinute).toBeLessThan(res.items[1].startMinute);
  });

  it("respects the date window (excludes appointments outside)", async () => {
    await actAs("owner", () =>
      createAppointment(
        validCreatePayload({
          startUTC: isoAt(FAR_FUTURE_DATE, 9, 0),
          endUTC: isoAt(FAR_FUTURE_DATE, 9, 30),
        }),
      ),
    );
    await actAs("owner", () =>
      createAppointment(
        validCreatePayload({
          startUTC: isoAt(FAR_FUTURE_DATE_2, 9, 0),
          endUTC: isoAt(FAR_FUTURE_DATE_2, 9, 30),
        }),
      ),
    );

    const res = await actAs("owner", () =>
      listAppointments({
        doctorId: String(doctorId),
        from: FAR_FUTURE_DATE,
        to: FAR_FUTURE_DATE,
      }),
    );
    expect(res.count).toBe(1);
  });

  it("returns only the requested doctor's appointments", async () => {
    await actAs("owner", () =>
      createAppointment(
        validCreatePayload({
          doctorId: String(doctorId),
          startUTC: isoAt(FAR_FUTURE_DATE, 9, 0),
          endUTC: isoAt(FAR_FUTURE_DATE, 9, 30),
        }),
      ),
    );
    await actAs("owner", () =>
      createAppointment(
        validCreatePayload({
          doctorId: String(doctor2Id),
          startUTC: isoAt(FAR_FUTURE_DATE, 9, 0),
          endUTC: isoAt(FAR_FUTURE_DATE, 9, 30),
        }),
      ),
    );

    const res = await actAs("owner", () =>
      listAppointments({
        doctorId: String(doctorId),
        from: FAR_FUTURE_DATE,
        to: FAR_FUTURE_DATE,
      }),
    );
    expect(res.count).toBe(1);
    expect(String(res.items[0].doctorId)).toBe(String(doctorId));
  });
});

// ════════════════════════════════════════════════════════════════
//  listAppointments — patient mode
// ════════════════════════════════════════════════════════════════

describe("listAppointments — patient mode", () => {
  it("returns a patient's history sorted by startUTC desc", async () => {
    await actAs("owner", () =>
      createAppointment(
        validCreatePayload({
          startUTC: isoAt(FAR_FUTURE_DATE, 9, 0),
          endUTC: isoAt(FAR_FUTURE_DATE, 9, 30),
        }),
      ),
    );
    await actAs("owner", () =>
      createAppointment(
        validCreatePayload({
          startUTC: isoAt(FAR_FUTURE_DATE_2, 9, 0),
          endUTC: isoAt(FAR_FUTURE_DATE_2, 9, 30),
        }),
      ),
    );

    const res = await actAs("owner", () =>
      listAppointments({ patientId: String(patientId) }),
    );
    expect(res.count).toBe(2);
    // First item should be the LATER one (desc order)
    expect(new Date(res.items[0].startUTC).getTime()).toBeGreaterThan(
      new Date(res.items[1].startUTC).getTime(),
    );
  });

  it("respects the limit parameter", async () => {
    for (let h = 9; h < 15; h++) {
      await actAs("owner", () =>
        createAppointment(
          validCreatePayload({
            startUTC: isoAt(FAR_FUTURE_DATE, h, 0),
            endUTC: isoAt(FAR_FUTURE_DATE, h, 30),
          }),
        ),
      );
    }
    const res = await actAs("owner", () =>
      listAppointments({ patientId: String(patientId), limit: 3 }),
    );
    expect(res.items.length).toBeLessThanOrEqual(3);
  });

  it("returns nextBefore cursor when more items exist", async () => {
    for (let h = 9; h < 15; h++) {
      await actAs("owner", () =>
        createAppointment(
          validCreatePayload({
            startUTC: isoAt(FAR_FUTURE_DATE, h, 0),
            endUTC: isoAt(FAR_FUTURE_DATE, h, 30),
          }),
        ),
      );
    }
    const res = await actAs("owner", () =>
      listAppointments({ patientId: String(patientId), limit: 3 }),
    );
    expect(res.nextBefore).toBeDefined();
  });

  it("doesn't return another patient's appointments", async () => {
    const otherPatient = await actAs("owner", () =>
      new ClinicPatient({
        clinicId,
        firstNameEncrypted: encryptValue("Other"),
        lastNameEncrypted: encryptValue("Patient"),
        createdBy: ownerId,
        createdByType: "user",
      }).save(),
    );

    await actAs("owner", () =>
      createAppointment(
        validCreatePayload({
          patientId: String(otherPatient._id),
          startUTC: isoAt(FAR_FUTURE_DATE, 9, 0),
          endUTC: isoAt(FAR_FUTURE_DATE, 9, 30),
        }),
      ),
    );
    await actAs("owner", () =>
      createAppointment(
        validCreatePayload({
          patientId: String(patientId),
          startUTC: isoAt(FAR_FUTURE_DATE, 10, 0),
          endUTC: isoAt(FAR_FUTURE_DATE, 10, 30),
        }),
      ),
    );

    const res = await actAs("owner", () =>
      listAppointments({ patientId: String(patientId) }),
    );
    expect(res.count).toBe(1);
    expect(String(res.items[0].patientId)).toBe(String(patientId));
  });
});
