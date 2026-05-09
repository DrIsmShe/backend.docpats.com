// __tests__/multitenancy-isolation.test.js
//
// CRITICAL: This test guarantees that no clinic can access another clinic's data.
// If this test ever fails — HALT all merges until fixed. It's a HIPAA boundary.

import { describe, it, expect, beforeEach } from "vitest";
import mongoose from "mongoose";
import { runWithTenantContext } from "../common/context/tenantContext.js";
import { standardModelPlugin } from "../common/plugins/standardModel.plugin.js";
import Clinic from "../modules/clinic/clinic-core/clinic.model.js";
import ClinicMembership from "../modules/clinic/clinic-staff/clinicMembership.model.js";
import { resolveActiveClinic } from "../common/services/clinicResolver.service.js";

// ─── TEST MODEL ────────────────────────────────────────────────
// We define a fake "Patient" model to simulate any tenant-scoped resource.

const patientSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    diagnosis: String,
  },
  { timestamps: true, collection: "test_patients" },
);
patientSchema.plugin(standardModelPlugin);

const TestPatient =
  mongoose.models.TestPatient || mongoose.model("TestPatient", patientSchema);

// ─── TEST DATA SETUP ──────────────────────────────────────────

let clinicA, clinicB;
let userOwnerA, userOwnerB, userMulti;
let patientInA, patientInB;

beforeEach(async () => {
  userOwnerA = new mongoose.Types.ObjectId();
  userOwnerB = new mongoose.Types.ObjectId();
  userMulti = new mongoose.Types.ObjectId();

  clinicA = await Clinic.create({
    name: "Clinic A",
    ownerId: userOwnerA,
    tier: "starter",
  });
  clinicB = await Clinic.create({
    name: "Clinic B",
    ownerId: userOwnerB,
    tier: "starter",
  });

  await ClinicMembership.create({
    userId: userOwnerA,
    clinicId: clinicA._id,
    role: "owner",
    isPrimary: true,
  });
  await ClinicMembership.create({
    userId: userOwnerB,
    clinicId: clinicB._id,
    role: "owner",
    isPrimary: true,
  });
  await ClinicMembership.create({
    userId: userMulti,
    clinicId: clinicA._id,
    role: "doctor",
    isPrimary: true,
  });
  await ClinicMembership.create({
    userId: userMulti,
    clinicId: clinicB._id,
    role: "manager",
    isPrimary: false,
  });

  patientInA = await runWithTenantContext(
    { userId: userOwnerA, clinicId: String(clinicA._id), role: "owner" },
    async () => TestPatient.create({ name: "Patient A1", diagnosis: "PHI A" }),
  );
  patientInB = await runWithTenantContext(
    { userId: userOwnerB, clinicId: String(clinicB._id), role: "owner" },
    async () => TestPatient.create({ name: "Patient B1", diagnosis: "PHI B" }),
  );
});

// ─── ISOLATION TESTS ─────────────────────────────────────────

describe("CRITICAL: multi-tenancy isolation", () => {
  it("clinic A doctor cannot list clinic B patients", async () => {
    const visible = await runWithTenantContext(
      { userId: userOwnerA, clinicId: String(clinicA._id), role: "owner" },
      async () => TestPatient.find({}),
    );

    expect(visible).toHaveLength(1);
    expect(visible[0].name).toBe("Patient A1");
    expect(String(visible[0].clinicId)).toBe(String(clinicA._id));
  });

  it("clinic B doctor cannot list clinic A patients", async () => {
    const visible = await runWithTenantContext(
      { userId: userOwnerB, clinicId: String(clinicB._id), role: "owner" },
      async () => TestPatient.find({}),
    );

    expect(visible).toHaveLength(1);
    expect(visible[0].name).toBe("Patient B1");
  });

  it("findById of foreign patient returns null", async () => {
    const found = await runWithTenantContext(
      { userId: userOwnerA, clinicId: String(clinicA._id), role: "owner" },
      async () => TestPatient.findById(patientInB._id),
    );

    expect(found).toBeNull();
  });

  it("findOne with foreign patient name returns null", async () => {
    const found = await runWithTenantContext(
      { userId: userOwnerA, clinicId: String(clinicA._id), role: "owner" },
      async () => TestPatient.findOne({ name: "Patient B1" }),
    );

    expect(found).toBeNull();
  });

  it("explicit cross-tenant filter is rejected", async () => {
    await expect(
      runWithTenantContext(
        { userId: userOwnerA, clinicId: String(clinicA._id), role: "owner" },
        async () => TestPatient.find({ clinicId: clinicB._id }),
      ),
    ).rejects.toThrow(/cross-tenant/i);
  });

  it("countDocuments respects tenant scope", async () => {
    const countA = await runWithTenantContext(
      { userId: userOwnerA, clinicId: String(clinicA._id), role: "owner" },
      async () => TestPatient.countDocuments({}),
    );
    expect(countA).toBe(1);

    const countB = await runWithTenantContext(
      { userId: userOwnerB, clinicId: String(clinicB._id), role: "owner" },
      async () => TestPatient.countDocuments({}),
    );
    expect(countB).toBe(1);
  });

  it("updateOne cannot touch foreign documents", async () => {
    const result = await runWithTenantContext(
      { userId: userOwnerA, clinicId: String(clinicA._id), role: "owner" },
      async () =>
        TestPatient.updateOne(
          { _id: patientInB._id },
          { $set: { diagnosis: "tampered" } },
        ),
    );

    expect(result.matchedCount).toBe(0);
    expect(result.modifiedCount).toBe(0);

    // Verify B's patient is intact
    const bIntact = await runWithTenantContext(
      { userId: userOwnerB, clinicId: String(clinicB._id), role: "owner" },
      async () => TestPatient.findById(patientInB._id),
    );
    expect(bIntact.diagnosis).toBe("PHI B");
  });

  it("deleteOne cannot delete foreign documents", async () => {
    const result = await runWithTenantContext(
      { userId: userOwnerA, clinicId: String(clinicA._id), role: "owner" },
      async () => TestPatient.deleteOne({ _id: patientInB._id }),
    );

    expect(result.deletedCount).toBe(0);

    const bIntact = await runWithTenantContext(
      { userId: userOwnerB, clinicId: String(clinicB._id), role: "owner" },
      async () => TestPatient.findById(patientInB._id),
    );
    expect(bIntact).not.toBeNull();
  });

  it("create automatically uses context's clinicId", async () => {
    const created = await runWithTenantContext(
      { userId: userOwnerA, clinicId: String(clinicA._id), role: "owner" },
      async () => TestPatient.create({ name: "Auto-clinicId test" }),
    );

    expect(String(created.clinicId)).toBe(String(clinicA._id));
  });

  it("multi-clinic user only sees data of currently active clinic", async () => {
    const visibleInA = await runWithTenantContext(
      { userId: userMulti, clinicId: String(clinicA._id), role: "doctor" },
      async () => TestPatient.find({}),
    );
    expect(visibleInA).toHaveLength(1);
    expect(visibleInA[0].name).toBe("Patient A1");

    const visibleInB = await runWithTenantContext(
      { userId: userMulti, clinicId: String(clinicB._id), role: "manager" },
      async () => TestPatient.find({}),
    );
    expect(visibleInB).toHaveLength(1);
    expect(visibleInB[0].name).toBe("Patient B1");
  });
});

// ─── RESOLVER ISOLATION TESTS ────────────────────────────────

describe("CRITICAL: clinic resolver isolation", () => {
  it("user without membership in clinic B cannot resolve to it", async () => {
    const result = await resolveActiveClinic(userOwnerA, String(clinicB._id));
    expect(result).toBeNull();
  });

  it("user with membership in clinic B can resolve to it", async () => {
    const result = await resolveActiveClinic(userMulti, String(clinicB._id));
    expect(result).not.toBeNull();
    expect(String(result.clinicId)).toBe(String(clinicB._id));
    expect(result.role).toBe("manager");
  });

  it("user without active membership returns null", async () => {
    const orphanUser = new mongoose.Types.ObjectId();
    const result = await resolveActiveClinic(orphanUser);
    expect(result).toBeNull();
  });

  it("left member is excluded from resolution", async () => {
    await ClinicMembership.findOneAndUpdate(
      { userId: userOwnerA, clinicId: clinicA._id },
      { leftAt: new Date() },
    );
    const result = await resolveActiveClinic(userOwnerA);
    expect(result).toBeNull();
  });
});

// ─── SOFT DELETE ISOLATION TESTS ────────────────────────────

describe("soft delete respects tenant scope", () => {
  it("soft-deleted records are hidden from default queries", async () => {
    await runWithTenantContext(
      { userId: userOwnerA, clinicId: String(clinicA._id), role: "owner" },
      async () => {
        const p = await TestPatient.findById(patientInA._id);
        await p.softDelete();

        const visible = await TestPatient.find({});
        expect(visible).toHaveLength(0);
      },
    );
  });

  it("findIncludingDeleted respects tenant scope", async () => {
    await runWithTenantContext(
      { userId: userOwnerA, clinicId: String(clinicA._id), role: "owner" },
      async () => {
        const p = await TestPatient.findById(patientInA._id);
        await p.softDelete();

        const all = await TestPatient.findIncludingDeleted({});
        expect(all).toHaveLength(1);
        expect(all[0].name).toBe("Patient A1");
        // CRITICAL: even with includeDeleted, we only see OUR clinic
      },
    );
  });
});
