// server/__tests__/clinic-patients/createPatient.department.test.js
//
// Tests for optional departmentId on ClinicPatient create/update
// (Jun 2026). departmentId is validated against the clinic's ACTIVE
// departments via assertDepartmentInClinic (cross-module guard from
// clinic-departments). Covers:
//   - create without departmentId            → null
//   - create with a valid active department  → linked
//   - create with another clinic's dept      → ValidationError (isolation)
//   - create with an archived department      → ValidationError
//   - create with a non-existent id           → ValidationError
//   - update sets / clears (null) the dept
//
// Harness mirrors createPatient.dedup.test.js: actAs() wraps the call
// in tenant context with the "owner" role (has patient.write).

import { describe, it, expect, beforeEach } from "vitest";
import mongoose from "mongoose";

import {
  createPatient,
  updatePatient,
} from "../../modules/clinic/clinic-patients/services/patient.service.js";
import ClinicPatient from "../../modules/clinic/clinic-patients/models/clinicPatient.model.js";
import { ClinicDepartment } from "../../modules/clinic/clinic-departments/models/clinicDepartment.model.js";
import ClinicMembership from "../../modules/clinic/clinic-staff/models/clinicMembership.model.js";
import Clinic from "../../modules/clinic/clinic-core/models/clinic.model.js";
import User from "../../common/models/Auth/users.js";
import { runWithTenantContext } from "../../common/context/tenantContext.js";
import { ValidationError } from "../../common/utils/errors.js";

// ─── Fixture state ────────────────────────────────────────────────────

let clinicId;
let otherClinicId;
let ownerId;
let department; // active dept in main clinic
let archivedDepartment; // archived dept in main clinic
let otherClinicDepartment; // active dept in OTHER clinic

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

// ─── Setup ────────────────────────────────────────────────────────────

beforeEach(async () => {
  await Clinic.collection.deleteMany({});
  await ClinicMembership.collection.deleteMany({});
  await ClinicPatient.collection.deleteMany({});
  await ClinicDepartment.collection.deleteMany({});
  await User.collection.deleteMany({});

  clinicId = new mongoose.Types.ObjectId();
  otherClinicId = new mongoose.Types.ObjectId();
  ownerId = new mongoose.Types.ObjectId();

  await Clinic.create({
    _id: clinicId,
    name: "Main Clinic",
    slug: `main-clinic-${clinicId.toString().slice(-8)}`,
    ownerId,
    timezone: "Asia/Baku",
  });
  await Clinic.create({
    _id: otherClinicId,
    name: "Other Clinic",
    slug: `other-clinic-${otherClinicId.toString().slice(-8)}`,
    ownerId,
    timezone: "Asia/Baku",
  });

  await ClinicMembership.create({
    userId: ownerId,
    clinicId,
    role: "owner",
    actorType: "user",
    isActive: true,
    isPrimary: true,
    joinedAt: new Date(),
  });

  // Departments created directly via the model (the service's tenant
  // scoping isn't needed for fixture setup — we set clinicId explicitly).
  department = await ClinicDepartment.create({
    clinicId,
    name: "Neurology",
    specialty: "neurology",
    status: "active",
  });
  archivedDepartment = await ClinicDepartment.create({
    clinicId,
    name: "Old Cardiology",
    specialty: "cardiology",
    status: "archived",
  });
  otherClinicDepartment = await ClinicDepartment.create({
    clinicId: otherClinicId,
    name: "Foreign ENT",
    specialty: "ent",
    status: "active",
  });
});

// ════════════════════════════════════════════════════════════════
//  CREATE
// ════════════════════════════════════════════════════════════════

describe("createPatient — departmentId", () => {
  it("defaults to null when departmentId is not provided", async () => {
    const result = await actAs("owner", () =>
      createPatient({
        firstName: "No",
        lastName: "Dept",
        phone: "+994500000001",
        dateOfBirth: new Date("1990-01-01"),
      }),
    );

    const patient = result?.patient ?? result;
    expect(patient.departmentId).toBeNull();
  });

  it("links a valid active department in this clinic", async () => {
    const result = await actAs("owner", () =>
      createPatient({
        firstName: "Has",
        lastName: "Dept",
        phone: "+994500000002",
        dateOfBirth: new Date("1990-01-01"),
        departmentId: String(department._id),
      }),
    );

    const patient = result?.patient ?? result;
    expect(String(patient.departmentId)).toBe(String(department._id));

    // Persisted on the document too
    const fromDb = await ClinicPatient.findById(patient._id).lean();
    expect(String(fromDb.departmentId)).toBe(String(department._id));
  });

  it("rejects a department that belongs to ANOTHER clinic (tenant isolation)", async () => {
    await expect(
      actAs("owner", () =>
        createPatient({
          firstName: "Cross",
          lastName: "Tenant",
          phone: "+994500000003",
          dateOfBirth: new Date("1990-01-01"),
          departmentId: String(otherClinicDepartment._id),
        }),
      ),
    ).rejects.toBeInstanceOf(ValidationError);

    // Nothing created
    expect(await ClinicPatient.countDocuments({})).toBe(0);
  });

  it("rejects an archived department", async () => {
    await expect(
      actAs("owner", () =>
        createPatient({
          firstName: "Arch",
          lastName: "Dept",
          phone: "+994500000004",
          dateOfBirth: new Date("1990-01-01"),
          departmentId: String(archivedDepartment._id),
        }),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects a non-existent department id", async () => {
    const ghost = new mongoose.Types.ObjectId();
    await expect(
      actAs("owner", () =>
        createPatient({
          firstName: "Ghost",
          lastName: "Dept",
          phone: "+994500000005",
          dateOfBirth: new Date("1990-01-01"),
          departmentId: String(ghost),
        }),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("does not leave an orphan provisional User when departmentId is invalid", async () => {
    // departmentId validated BEFORE provisional creation — so even with
    // createProvisionalUser=true, a bad dept must abort before any User
    // is created.
    const ghost = new mongoose.Types.ObjectId();
    await expect(
      actAs("owner", () =>
        createPatient({
          firstName: "Ghost",
          lastName: "Provisional",
          dateOfBirth: new Date("1990-01-01"),
          createProvisionalUser: true,
          departmentId: String(ghost),
        }),
      ),
    ).rejects.toBeInstanceOf(ValidationError);

    expect(await User.countDocuments({})).toBe(0);
    expect(await ClinicPatient.countDocuments({})).toBe(0);
  });
});

// ════════════════════════════════════════════════════════════════
//  UPDATE
// ════════════════════════════════════════════════════════════════

describe("updatePatient — departmentId", () => {
  async function makePatient() {
    const result = await actAs("owner", () =>
      createPatient({
        firstName: "Edit",
        lastName: "Me",
        phone: "+994500000010",
        dateOfBirth: new Date("1990-01-01"),
      }),
    );
    return result?.patient ?? result;
  }

  it("assigns a department on update", async () => {
    const patient = await makePatient();

    const updated = await actAs("owner", () =>
      updatePatient(String(patient._id), {
        departmentId: String(department._id),
      }),
    );

    expect(String(updated.departmentId)).toBe(String(department._id));
  });

  it("clears the department when departmentId = null", async () => {
    const patient = await makePatient();

    await actAs("owner", () =>
      updatePatient(String(patient._id), {
        departmentId: String(department._id),
      }),
    );
    const cleared = await actAs("owner", () =>
      updatePatient(String(patient._id), { departmentId: null }),
    );

    expect(cleared.departmentId).toBeNull();
  });

  it("rejects assigning another clinic's department on update", async () => {
    const patient = await makePatient();

    await expect(
      actAs("owner", () =>
        updatePatient(String(patient._id), {
          departmentId: String(otherClinicDepartment._id),
        }),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("rejects assigning an archived department on update", async () => {
    const patient = await makePatient();

    await expect(
      actAs("owner", () =>
        updatePatient(String(patient._id), {
          departmentId: String(archivedDepartment._id),
        }),
      ),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});
