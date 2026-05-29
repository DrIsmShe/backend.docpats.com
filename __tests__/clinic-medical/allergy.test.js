// __tests__/clinic-medical/allergy.test.js
//
// Integration tests for allergy sub-record service (subRecordBase via allergy config).
// Sprint 2 Phase 2C.
//
// Coverage:
//   1. create — user actor (doctorId set)
//   2. create — employee actor (createdByEmployee set)
//   3. create — empty content rejected (schema-level; here we test service guard)
//   4. get — owner clinic can read
//   5. get — foreign clinic DENIED without consent
//   6. get — foreign clinic ALLOWED via global consent (isCrossClinic flag)
//   7. list — owner sees own, foreign sees nothing without consent
//   8. update — owner can edit
//   9. update — foreign clinic (consent reader) CANNOT edit
//  10. delete — owner deletes; record gone

import { describe, it, expect, beforeEach } from "vitest";
import mongoose from "mongoose";
import { runWithTenantContext } from "../../common/context/tenantContext.js";
import AllergiesPatient from "../../common/models/Polyclinic/MedicalHistory/allergiesPatient.js";
import PatientConsent from "../../common/models/Polyclinic/PatientConsent.js";
import allergyService from "../../modules/clinic/clinic-medical/services/allergy.service.js";

const oid = () => new mongoose.Types.ObjectId();

function makeCtx({
  clinicId,
  userId = oid(),
  role = "doctor",
  actorType = "user",
}) {
  return {
    userId: String(userId),
    clinicId: String(clinicId),
    role,
    actorType,
  };
}

function fakePatient() {
  return { _id: oid() };
}

// ─── CREATE ───────────────────────────────────────────────────────────

describe("allergy.create", () => {
  let clinicA, doctorA, patient;
  beforeEach(() => {
    clinicA = oid();
    doctorA = oid();
    patient = fakePatient();
  });

  it("creates allergy with user actor (doctorId)", async () => {
    const result = await runWithTenantContext(
      makeCtx({ clinicId: clinicA, userId: doctorA, role: "doctor" }),
      () =>
        allergyService.create({
          patient,
          body: { content: "Penicillin → rash" },
        }),
    );

    expect(result.content).toBe("Penicillin → rash");
    expect(String(result.doctorId)).toBe(String(doctorA));
    expect(result.createdByEmployee).toBeNull();
    expect(String(result.createdByClinicId)).toBe(String(clinicA));
  });

  it("creates allergy with employee actor (createdByEmployee)", async () => {
    const nurseId = oid();
    const result = await runWithTenantContext(
      makeCtx({
        clinicId: clinicA,
        userId: nurseId,
        role: "nurse",
        actorType: "employee",
      }),
      () =>
        allergyService.create({
          patient,
          body: { content: "Sulfa drugs" },
        }),
    );

    expect(result.doctorId).toBeNull();
    expect(String(result.createdByEmployee)).toBe(String(nurseId));
    expect(String(result.createdByClinicId)).toBe(String(clinicA));
  });
});

// ─── GET + ACCESS CHAIN ─────────────────────────────────────────────────

describe("allergy.get — access chain", () => {
  let clinicA, clinicB, doctorA, doctorB, patient, recordId;

  beforeEach(async () => {
    clinicA = oid();
    clinicB = oid();
    doctorA = oid();
    doctorB = oid();
    patient = fakePatient();

    const created = await runWithTenantContext(
      makeCtx({ clinicId: clinicA, userId: doctorA, role: "doctor" }),
      () => allergyService.create({ patient, body: { content: "Aspirin" } }),
    );
    recordId = created._id;
  });

  it("owner clinic reads its own allergy", async () => {
    const result = await runWithTenantContext(
      makeCtx({ clinicId: clinicA, userId: doctorA, role: "doctor" }),
      () => allergyService.get({ recordId }),
    );
    expect(result.content).toBe("Aspirin");
    expect(result.isCrossClinic).toBeUndefined();
  });

  it("foreign clinic DENIED without consent", async () => {
    await expect(
      runWithTenantContext(
        makeCtx({ clinicId: clinicB, userId: doctorB, role: "doctor" }),
        () => allergyService.get({ recordId }),
      ),
    ).rejects.toThrow(/No access|ACCESS_DENIED|Forbidden/i);
  });

  it("foreign clinic ALLOWED via global consent", async () => {
    await PatientConsent.create({
      patientRef: patient._id,
      patientTypeModel: "ClinicPatient",
      clinicId: clinicB,
      purpose: "referral",
      scopes: { allergies: true },
      signedAt: new Date(),
      signedByPatient: oid(),
      signatureMethod: "electronic",
    });

    const result = await runWithTenantContext(
      makeCtx({ clinicId: clinicB, userId: doctorB, role: "doctor" }),
      () => allergyService.get({ recordId }),
    );
    expect(result.content).toBe("Aspirin");
    expect(result.isCrossClinic).toBe(true);
  });
});

// ─── LIST ───────────────────────────────────────────────────────────────

describe("allergy.list", () => {
  let clinicA, clinicB, doctorA, doctorB, patient;

  beforeEach(async () => {
    clinicA = oid();
    clinicB = oid();
    doctorA = oid();
    doctorB = oid();
    patient = fakePatient();

    await runWithTenantContext(
      makeCtx({ clinicId: clinicA, userId: doctorA, role: "doctor" }),
      () => allergyService.create({ patient, body: { content: "Latex" } }),
    );
  });

  it("owner sees its allergy", async () => {
    const result = await runWithTenantContext(
      makeCtx({ clinicId: clinicA, userId: doctorA, role: "doctor" }),
      () => allergyService.list({ patient, query: {} }),
    );
    expect(result.count).toBe(1);
    expect(result.items[0].content).toBe("Latex");
  });

  it("foreign clinic sees nothing without consent", async () => {
    const result = await runWithTenantContext(
      makeCtx({ clinicId: clinicB, userId: doctorB, role: "doctor" }),
      () => allergyService.list({ patient, query: {} }),
    );
    expect(result.count).toBe(0);
  });

  it("foreign clinic sees via consent (isCrossClinic flag)", async () => {
    await PatientConsent.create({
      patientRef: patient._id,
      patientTypeModel: "ClinicPatient",
      clinicId: clinicB,
      purpose: "referral",
      scopes: { allergies: true },
      signedAt: new Date(),
      signedByPatient: oid(),
      signatureMethod: "electronic",
    });

    const result = await runWithTenantContext(
      makeCtx({ clinicId: clinicB, userId: doctorB, role: "doctor" }),
      () => allergyService.list({ patient, query: {} }),
    );
    expect(result.count).toBe(1);
    expect(result.items[0].isCrossClinic).toBe(true);
  });
});

// ─── UPDATE ─────────────────────────────────────────────────────────────

describe("allergy.update", () => {
  let clinicA, clinicB, doctorA, doctorB, patient, recordId;

  beforeEach(async () => {
    clinicA = oid();
    clinicB = oid();
    doctorA = oid();
    doctorB = oid();
    patient = fakePatient();

    const created = await runWithTenantContext(
      makeCtx({ clinicId: clinicA, userId: doctorA, role: "doctor" }),
      () => allergyService.create({ patient, body: { content: "Old text" } }),
    );
    recordId = created._id;
  });

  it("owner edits content", async () => {
    const result = await runWithTenantContext(
      makeCtx({ clinicId: clinicA, userId: doctorA, role: "doctor" }),
      () => allergyService.update({ recordId, body: { content: "New text" } }),
    );
    expect(result.content).toBe("New text");
  });

  it("foreign clinic with consent CANNOT edit (read-only)", async () => {
    await PatientConsent.create({
      patientRef: patient._id,
      patientTypeModel: "ClinicPatient",
      clinicId: clinicB,
      purpose: "referral",
      scopes: { allergies: true },
      signedAt: new Date(),
      signedByPatient: oid(),
      signatureMethod: "electronic",
    });

    await expect(
      runWithTenantContext(
        makeCtx({ clinicId: clinicB, userId: doctorB, role: "doctor" }),
        () => allergyService.update({ recordId, body: { content: "hack" } }),
      ),
    ).rejects.toThrow(
      /Only the clinic that created|NOT_RECORD_OWNER|Forbidden/i,
    );
  });
});

// ─── DELETE ─────────────────────────────────────────────────────────────

describe("allergy.remove", () => {
  it("owner deletes record", async () => {
    // NOTE: per ROLE_PERMISSIONS, medical_record.delete is OWNER-ONLY.
    // doctor/admin/nurse have RW (no delete). So we create as doctor but
    // delete as owner — mirrors real clinical workflow (records aren't
    // erased by just anyone; deletion is a clinic-owner action).
    const clinicA = oid();
    const doctorA = oid();
    const ownerA = oid();
    const patient = fakePatient();

    const created = await runWithTenantContext(
      makeCtx({ clinicId: clinicA, userId: doctorA, role: "doctor" }),
      () => allergyService.create({ patient, body: { content: "Bee sting" } }),
    );

    const result = await runWithTenantContext(
      makeCtx({ clinicId: clinicA, userId: ownerA, role: "owner" }),
      () => allergyService.remove({ recordId: created._id }),
    );
    expect(result.deleted).toBe(true);

    const gone = await AllergiesPatient.findById(created._id);
    expect(gone).toBeNull();
  });

  it("doctor CANNOT delete (only owner)", async () => {
    const clinicA = oid();
    const doctorA = oid();
    const patient = fakePatient();

    const created = await runWithTenantContext(
      makeCtx({ clinicId: clinicA, userId: doctorA, role: "doctor" }),
      () => allergyService.create({ patient, body: { content: "Pollen" } }),
    );

    await expect(
      runWithTenantContext(
        makeCtx({ clinicId: clinicA, userId: doctorA, role: "doctor" }),
        () => allergyService.remove({ recordId: created._id }),
      ),
    ).rejects.toThrow(/Permission denied.*medical_record\.delete|Forbidden/i);
  });
});
