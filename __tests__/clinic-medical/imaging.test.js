// __tests__/clinic-medical/imaging.test.js
//
// Integration tests for imaging study service (clinic-medical).
// Sprint 2 Phase 2C.2.
//
// Tests operate at SERVICE level — images are passed as ready URL strings
// (the controller/processFiles/R2 upload path is NOT exercised here; that's
// verified manually in the browser). This keeps tests free of S3 mocks.
//
// Coverage:
//   1. create — user actor, with images[]
//   2. create — employee actor (nurse), authorship
//   3. create — invalid studyType rejected
//   4. create — patientId set (not legacy patient)
//   5. get — owner reads; foreign denied; consent allows (isCrossClinic)
//   6. list — own clinic only without consent; studyType filter
//   7. update — owner edits report/diagnosis/validatedByDoctor; foreign denied
//   8. delete — owner deletes, returns orphanedImages

import { describe, it, expect, beforeEach } from "vitest";
import mongoose from "mongoose";
import { runWithTenantContext } from "../../common/context/tenantContext.js";
import ImagingStudy from "../../common/models/Polyclinic/MedicalHistory/ImagingStudy.js";
import PatientConsent from "../../common/models/Polyclinic/PatientConsent.js";
import * as svc from "../../modules/clinic/clinic-medical/services/imaging.service.js";

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

const IMG_URLS = [
  "https://media.docpats.com/uploads/images/a1.webp",
  "https://media.docpats.com/uploads/images/a2.webp",
];

// ─── CREATE ───────────────────────────────────────────────────────────

describe("imaging.create", () => {
  let clinicA, doctorA, patient;
  beforeEach(() => {
    clinicA = oid();
    doctorA = oid();
    patient = fakePatient();
  });

  it("creates imaging with user actor + images", async () => {
    const result = await runWithTenantContext(
      makeCtx({ clinicId: clinicA, userId: doctorA, role: "doctor" }),
      () =>
        svc.createImaging({
          patient,
          body: {
            studyType: "CT",
            report: "No acute findings",
            diagnosis: "Normal sinuses",
            contrastUsed: true,
          },
          images: IMG_URLS,
        }),
    );

    expect(result.studyType).toBe("CT");
    expect(result.images).toEqual(IMG_URLS);
    expect(result.report).toBe("No acute findings");
    expect(result.contrastUsed).toBe(true);
    expect(String(result.patientId)).toBe(String(patient._id));
    expect(String(result.createdBy)).toBe(String(doctorA));
    expect(String(result.createdByClinicId)).toBe(String(clinicA));
  });

  it("creates imaging with employee actor (nurse)", async () => {
    const nurseId = oid();
    const result = await runWithTenantContext(
      makeCtx({
        clinicId: clinicA,
        userId: nurseId,
        role: "nurse",
        actorType: "employee",
      }),
      () =>
        svc.createImaging({
          patient,
          body: { studyType: "USG" },
          images: [],
        }),
    );

    expect(result.studyType).toBe("USG");
    expect(result.doctorId).toBeUndefined(); // shape doesn't expose doctorId
    expect(String(result.createdByEmployee)).toBe(String(nurseId));
    expect(String(result.createdByClinicId)).toBe(String(clinicA));
  });

  it("rejects invalid studyType", async () => {
    await expect(
      runWithTenantContext(
        makeCtx({ clinicId: clinicA, userId: doctorA, role: "doctor" }),
        () =>
          svc.createImaging({
            patient,
            body: { studyType: "TELEPATHY" },
            images: [],
          }),
      ),
    ).rejects.toThrow(/studyType.*must be one of|studyType is required/i);
  });

  it("persists patientId, leaves legacy patient null", async () => {
    const result = await runWithTenantContext(
      makeCtx({ clinicId: clinicA, userId: doctorA, role: "doctor" }),
      () =>
        svc.createImaging({
          patient,
          body: { studyType: "MRI" },
          images: [],
        }),
    );

    const doc = await ImagingStudy.findById(result._id).lean();
    expect(String(doc.patientId)).toBe(String(patient._id));
    expect(doc.patient).toBeNull();
  });
});

// ─── GET + ACCESS CHAIN ─────────────────────────────────────────────────

describe("imaging.get — access chain", () => {
  let clinicA, clinicB, doctorA, doctorB, patient, recordId;

  beforeEach(async () => {
    clinicA = oid();
    clinicB = oid();
    doctorA = oid();
    doctorB = oid();
    patient = fakePatient();

    const created = await runWithTenantContext(
      makeCtx({ clinicId: clinicA, userId: doctorA, role: "doctor" }),
      () =>
        svc.createImaging({
          patient,
          body: { studyType: "X-Ray", diagnosis: "Fracture" },
          images: IMG_URLS,
        }),
    );
    recordId = created._id;
  });

  it("owner reads its own study", async () => {
    const result = await runWithTenantContext(
      makeCtx({ clinicId: clinicA, userId: doctorA, role: "doctor" }),
      () => svc.getImaging({ recordId }),
    );
    expect(result.diagnosis).toBe("Fracture");
    expect(result.isCrossClinic).toBeUndefined();
  });

  it("foreign clinic DENIED without consent", async () => {
    await expect(
      runWithTenantContext(
        makeCtx({ clinicId: clinicB, userId: doctorB, role: "doctor" }),
        () => svc.getImaging({ recordId }),
      ),
    ).rejects.toThrow(/No access|ACCESS_DENIED|Forbidden/i);
  });

  it("foreign clinic ALLOWED via global consent (imaging scope)", async () => {
    await PatientConsent.create({
      patientRef: patient._id,
      patientTypeModel: "ClinicPatient",
      clinicId: clinicB,
      purpose: "second_opinion",
      scopes: { imaging: true },
      signedAt: new Date(),
      signedByPatient: oid(),
      signatureMethod: "electronic",
    });

    const result = await runWithTenantContext(
      makeCtx({ clinicId: clinicB, userId: doctorB, role: "doctor" }),
      () => svc.getImaging({ recordId }),
    );
    expect(result.diagnosis).toBe("Fracture");
    expect(result.isCrossClinic).toBe(true);
  });
});

// ─── LIST ───────────────────────────────────────────────────────────────

describe("imaging.list", () => {
  let clinicA, clinicB, doctorA, doctorB, patient;

  beforeEach(async () => {
    clinicA = oid();
    clinicB = oid();
    doctorA = oid();
    doctorB = oid();
    patient = fakePatient();

    await runWithTenantContext(
      makeCtx({ clinicId: clinicA, userId: doctorA, role: "doctor" }),
      () =>
        svc.createImaging({ patient, body: { studyType: "CT" }, images: [] }),
    );
    await runWithTenantContext(
      makeCtx({ clinicId: clinicA, userId: doctorA, role: "doctor" }),
      () =>
        svc.createImaging({ patient, body: { studyType: "MRI" }, images: [] }),
    );
  });

  it("owner sees both studies", async () => {
    const result = await runWithTenantContext(
      makeCtx({ clinicId: clinicA, userId: doctorA, role: "doctor" }),
      () => svc.listImaging({ patient, query: {} }),
    );
    expect(result.count).toBe(2);
  });

  it("studyType filter narrows results", async () => {
    const result = await runWithTenantContext(
      makeCtx({ clinicId: clinicA, userId: doctorA, role: "doctor" }),
      () => svc.listImaging({ patient, query: { studyType: "CT" } }),
    );
    expect(result.count).toBe(1);
    expect(result.items[0].studyType).toBe("CT");
  });

  it("foreign clinic sees nothing without consent", async () => {
    const result = await runWithTenantContext(
      makeCtx({ clinicId: clinicB, userId: doctorB, role: "doctor" }),
      () => svc.listImaging({ patient, query: {} }),
    );
    expect(result.count).toBe(0);
  });
});

// ─── UPDATE ─────────────────────────────────────────────────────────────

describe("imaging.update", () => {
  let clinicA, clinicB, doctorA, doctorB, patient, recordId;

  beforeEach(async () => {
    clinicA = oid();
    clinicB = oid();
    doctorA = oid();
    doctorB = oid();
    patient = fakePatient();

    const created = await runWithTenantContext(
      makeCtx({ clinicId: clinicA, userId: doctorA, role: "doctor" }),
      () =>
        svc.createImaging({
          patient,
          body: { studyType: "CT", report: "draft" },
          images: [],
        }),
    );
    recordId = created._id;
  });

  it("owner edits report + sets validatedByDoctor", async () => {
    const result = await runWithTenantContext(
      makeCtx({ clinicId: clinicA, userId: doctorA, role: "doctor" }),
      () =>
        svc.updateImaging({
          recordId,
          body: { report: "Final report", validatedByDoctor: true },
        }),
    );
    expect(result.report).toBe("Final report");
    expect(result.validatedByDoctor).toBe(true);
  });

  it("foreign clinic with consent CANNOT edit", async () => {
    await PatientConsent.create({
      patientRef: patient._id,
      patientTypeModel: "ClinicPatient",
      clinicId: clinicB,
      purpose: "referral",
      scopes: { imaging: true },
      signedAt: new Date(),
      signedByPatient: oid(),
      signatureMethod: "electronic",
    });

    await expect(
      runWithTenantContext(
        makeCtx({ clinicId: clinicB, userId: doctorB, role: "doctor" }),
        () => svc.updateImaging({ recordId, body: { report: "hack" } }),
      ),
    ).rejects.toThrow(
      /Only the clinic that created|NOT_RECORD_OWNER|Forbidden/i,
    );
  });
});

// ─── DELETE ─────────────────────────────────────────────────────────────

describe("imaging.delete", () => {
  it("owner deletes, returns orphanedImages list", async () => {
    const clinicA = oid();
    const ownerA = oid();
    const patient = fakePatient();

    const created = await runWithTenantContext(
      makeCtx({ clinicId: clinicA, userId: ownerA, role: "owner" }),
      () =>
        svc.createImaging({
          patient,
          body: { studyType: "USG" },
          images: IMG_URLS,
        }),
    );

    const result = await runWithTenantContext(
      makeCtx({ clinicId: clinicA, userId: ownerA, role: "owner" }),
      () => svc.deleteImaging({ recordId: created._id }),
    );

    expect(result.deleted).toBe(true);
    expect(result.orphanedImages).toEqual(IMG_URLS);

    const gone = await ImagingStudy.findById(created._id);
    expect(gone).toBeNull();
  });

  it("doctor CANNOT delete (owner-only)", async () => {
    const clinicA = oid();
    const doctorA = oid();
    const patient = fakePatient();

    const created = await runWithTenantContext(
      makeCtx({ clinicId: clinicA, userId: doctorA, role: "doctor" }),
      () =>
        svc.createImaging({ patient, body: { studyType: "CT" }, images: [] }),
    );

    await expect(
      runWithTenantContext(
        makeCtx({ clinicId: clinicA, userId: doctorA, role: "doctor" }),
        () => svc.deleteImaging({ recordId: created._id }),
      ),
    ).rejects.toThrow(/Permission denied.*medical_record\.delete|Forbidden/i);
  });
});
