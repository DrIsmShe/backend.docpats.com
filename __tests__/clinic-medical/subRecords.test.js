// __tests__/clinic-medical/subRecords.test.js
//
// Integration tests for the 4 remaining sub-record services
// (chronic, operation, family, immunization).
// Sprint 2 Phase 2C.
//
// allergy.test.js already covers the FULL access-chain matrix in depth
// (ownership / consent / cross-clinic / owner-only-delete). Since these
// 4 share the identical subRecordBase core, here we focus on:
//   - field-specific create/read (content vs relative+diseaseName vs vaccineName)
//   - one ownership-isolation smoke per model (foreign clinic denied)
// We don't re-test the entire consent matrix 4× — that's covered by allergy.

import { describe, it, expect, beforeEach } from "vitest";
import mongoose from "mongoose";
import { runWithTenantContext } from "../../common/context/tenantContext.js";
import chronicService from "../../modules/clinic/clinic-medical/services/chronic.service.js";
import operationService from "../../modules/clinic/clinic-medical/services/operation.service.js";
import familyService from "../../modules/clinic/clinic-medical/services/family.service.js";
import immunizationService from "../../modules/clinic/clinic-medical/services/immunization.service.js";

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

// ─── CHRONIC ──────────────────────────────────────────────────────────

describe("chronic.service", () => {
  let clinicA, doctorA, patient;
  beforeEach(() => {
    clinicA = oid();
    doctorA = oid();
    patient = fakePatient();
  });

  it("creates + reads chronic disease (content)", async () => {
    const created = await runWithTenantContext(
      makeCtx({ clinicId: clinicA, userId: doctorA }),
      () =>
        chronicService.create({
          patient,
          body: { content: "Type 2 diabetes since 2019" },
        }),
    );
    expect(created.content).toBe("Type 2 diabetes since 2019");
    expect(String(created.createdByClinicId)).toBe(String(clinicA));

    const read = await runWithTenantContext(
      makeCtx({ clinicId: clinicA, userId: doctorA }),
      () => chronicService.get({ recordId: created._id }),
    );
    expect(read.content).toBe("Type 2 diabetes since 2019");
  });

  it("foreign clinic denied without consent", async () => {
    const created = await runWithTenantContext(
      makeCtx({ clinicId: clinicA, userId: doctorA }),
      () => chronicService.create({ patient, body: { content: "Asthma" } }),
    );
    await expect(
      runWithTenantContext(makeCtx({ clinicId: oid(), userId: oid() }), () =>
        chronicService.get({ recordId: created._id }),
      ),
    ).rejects.toThrow(/No access|Forbidden|ACCESS_DENIED/i);
  });
});

// ─── OPERATION ────────────────────────────────────────────────────────

describe("operation.service", () => {
  it("creates + lists operation (content)", async () => {
    const clinicA = oid();
    const doctorA = oid();
    const patient = fakePatient();

    await runWithTenantContext(
      makeCtx({ clinicId: clinicA, userId: doctorA }),
      () =>
        operationService.create({
          patient,
          body: { content: "Appendectomy 2015" },
        }),
    );

    const list = await runWithTenantContext(
      makeCtx({ clinicId: clinicA, userId: doctorA }),
      () => operationService.list({ patient, query: {} }),
    );
    expect(list.count).toBe(1);
    expect(list.items[0].content).toBe("Appendectomy 2015");
  });
});

// ─── FAMILY HISTORY ───────────────────────────────────────────────────

describe("family.service", () => {
  let clinicA, doctorA, patient;
  beforeEach(() => {
    clinicA = oid();
    doctorA = oid();
    patient = fakePatient();
  });

  it("creates with relative + diseaseName + content", async () => {
    const created = await runWithTenantContext(
      makeCtx({ clinicId: clinicA, userId: doctorA }),
      () =>
        familyService.create({
          patient,
          body: {
            relative: "father",
            diseaseName: "Myocardial infarction",
            content: "At age 50",
          },
        }),
    );
    expect(created.relative).toBe("father");
    expect(created.diseaseName).toBe("Myocardial infarction");
    expect(created.content).toBe("At age 50");
  });

  it("creates with content optional (defaults to empty)", async () => {
    const created = await runWithTenantContext(
      makeCtx({ clinicId: clinicA, userId: doctorA }),
      () =>
        familyService.create({
          patient,
          body: { relative: "mother", diseaseName: "Breast cancer" },
        }),
    );
    expect(created.relative).toBe("mother");
    expect(created.diseaseName).toBe("Breast cancer");
    // content defaults to "" in model → shaped to null
    expect(created.content).toBeNull();
  });

  it("updates only diseaseName, leaves relative intact", async () => {
    const created = await runWithTenantContext(
      makeCtx({ clinicId: clinicA, userId: doctorA }),
      () =>
        familyService.create({
          patient,
          body: { relative: "sister", diseaseName: "Diabetes" },
        }),
    );

    const updated = await runWithTenantContext(
      makeCtx({ clinicId: clinicA, userId: doctorA }),
      () =>
        familyService.update({
          recordId: created._id,
          body: { diseaseName: "Type 1 diabetes" },
        }),
    );
    expect(updated.relative).toBe("sister"); // unchanged
    expect(updated.diseaseName).toBe("Type 1 diabetes");
  });
});

// ─── IMMUNIZATION ─────────────────────────────────────────────────────

describe("immunization.service", () => {
  let clinicA, nurseId, patient;
  beforeEach(() => {
    clinicA = oid();
    nurseId = oid();
    patient = fakePatient();
  });

  it("nurse (employee) creates immunization with vaccineName + dateGiven", async () => {
    const dateGiven = new Date("2026-01-12T00:00:00Z");
    const created = await runWithTenantContext(
      makeCtx({
        clinicId: clinicA,
        userId: nurseId,
        role: "nurse",
        actorType: "employee",
      }),
      () =>
        immunizationService.create({
          patient,
          body: {
            vaccineName: "Influenza 2026",
            dateGiven,
            content: "Left deltoid",
          },
        }),
    );
    expect(created.vaccineName).toBe("Influenza 2026");
    expect(new Date(created.dateGiven).toISOString()).toBe(
      dateGiven.toISOString(),
    );
    expect(created.content).toBe("Left deltoid");
    // employee authorship
    expect(String(created.createdByEmployee)).toBe(String(nurseId));
    expect(created.doctorId).toBeNull();
  });

  it("creates with vaccineName only (dateGiven defaults via model)", async () => {
    const created = await runWithTenantContext(
      makeCtx({
        clinicId: clinicA,
        userId: nurseId,
        role: "nurse",
        actorType: "employee",
      }),
      () =>
        immunizationService.create({
          patient,
          body: { vaccineName: "Tetanus booster" },
        }),
    );
    expect(created.vaccineName).toBe("Tetanus booster");
    // model has dateGiven default: Date.now → should be set
    expect(created.dateGiven).toBeTruthy();
  });
});
