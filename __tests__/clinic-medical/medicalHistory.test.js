// __tests__/clinic-medical/medicalHistory.test.js
//
// Integration tests for clinic-medical encounter service.
// Sprint 2 Phase 2B.
//
// Coverage:
//   1. createEncounter — draft (no diagnosis) & signed (with diagnosis)
//   2. createEncounter — UMR validators fire (no author / employee no clinic)
//   3. signEncounter — draft → signed transition
//   4. signEncounter — refuses when not draft
//   5. amendEncounter — signed → amended, history grows, reason captured
//   6. updateEncounter — refuses non-draft
//   7. listEncountersForPatient — own clinic only (no cross-clinic without consent)
//   8. listEncountersForPatient — cross-clinic visible via global PatientConsent
//   9. deleteEncounter — removes record
//
// Each test runs inside runWithTenantContext so the service's
// tenantContext-based helpers (requireClinicId, requireActor) work.

import { describe, it, expect, beforeEach } from "vitest";
import mongoose from "mongoose";
import { runWithTenantContext } from "../../common/context/tenantContext.js";
import NewPatientMedicalHistory from "../../common/models/Polyclinic/MedicalHistory/newPatientMedicalHistory.js";
import PatientConsent from "../../common/models/Polyclinic/PatientConsent.js";
import * as svc from "../../modules/clinic/clinic-medical/services/medicalHistory.service.js";

// ─── helpers ──────────────────────────────────────────────────────────

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

// Fake "patient" stand-in (we don't need full ClinicPatient for these
// service-level tests — only patient._id is read in createEncounter).
function fakePatient() {
  return { _id: oid() };
}

const VALID_DX = {
  code: "J45.1",
  codeTitle: "Mild persistent asthma",
  text: "Bronchial asthma, mild persistent",
};

const FULL_BODY = {
  status: "signed",
  mainDiagnosis: VALID_DX,
  complaints: "Cough at night",
  anamnesisMorbi: "Started 2 weeks ago",
  recommendations: "Salbutamol PRN",
};

// ─── 1. CREATE ────────────────────────────────────────────────────────

describe("createEncounter", () => {
  let clinicA, doctorA, patient;

  beforeEach(() => {
    clinicA = oid();
    doctorA = oid();
    patient = fakePatient();
  });

  it("creates DRAFT encounter without diagnosis", async () => {
    const result = await runWithTenantContext(
      makeCtx({ clinicId: clinicA, userId: doctorA, role: "doctor" }),
      () =>
        svc.createEncounter({
          patient,
          body: { status: "draft" },
        }),
    );

    expect(result.status).toBe("draft");
    expect(result.signedAt).toBeNull();
    expect(result.signedByUserId).toBeNull();
    expect(result.mainDiagnosis).toEqual({ code: "", codeTitle: "", text: "" });
    expect(String(result.createdBy)).toBe(String(doctorA));
    expect(String(result.createdByClinicId)).toBe(String(clinicA));
    expect(result.createdByEmployee).toBeNull();
  });

  it("creates SIGNED encounter with diagnosis + signedBy", async () => {
    const result = await runWithTenantContext(
      makeCtx({ clinicId: clinicA, userId: doctorA, role: "doctor" }),
      () => svc.createEncounter({ patient, body: FULL_BODY }),
    );

    expect(result.status).toBe("signed");
    expect(result.signedAt).toBeInstanceOf(Date);
    expect(String(result.signedByUserId)).toBe(String(doctorA));
    expect(result.mainDiagnosis.code).toBe("J45.1");
  });

  it("rejects SIGNED encounter without mainDiagnosis", async () => {
    await expect(
      runWithTenantContext(
        makeCtx({ clinicId: clinicA, userId: doctorA, role: "doctor" }),
        () =>
          svc.createEncounter({
            patient,
            body: { status: "signed" }, // no mainDiagnosis
          }),
      ),
    ).rejects.toThrow(/Signed.*require.*ICD-10|Cannot sign/i);
  });

  it("employee actor sets createdByEmployee + createdByClinicId", async () => {
    const employeeId = oid();
    const result = await runWithTenantContext(
      makeCtx({
        clinicId: clinicA,
        userId: employeeId,
        role: "nurse",
        actorType: "employee",
      }),
      () => svc.createEncounter({ patient, body: { status: "draft" } }),
    );

    expect(result.createdBy).toBeNull();
    expect(String(result.createdByEmployee)).toBe(String(employeeId));
    expect(String(result.createdByClinicId)).toBe(String(clinicA));
  });
});

// ─── 2. SIGN ──────────────────────────────────────────────────────────

describe("signEncounter", () => {
  let clinicA, doctorA, patient;

  beforeEach(() => {
    clinicA = oid();
    doctorA = oid();
    patient = fakePatient();
  });

  it("transitions draft → signed with diagnosis supplied at sign-time", async () => {
    // 1. Create draft (no diagnosis)
    const draft = await runWithTenantContext(
      makeCtx({ clinicId: clinicA, userId: doctorA, role: "doctor" }),
      () =>
        svc.createEncounter({
          patient,
          body: { status: "draft", complaints: "Headache" },
        }),
    );

    expect(draft.status).toBe("draft");

    // 2. Reload as full document and sign
    const record = await NewPatientMedicalHistory.findById(draft._id);
    const signed = await runWithTenantContext(
      makeCtx({ clinicId: clinicA, userId: doctorA, role: "doctor" }),
      () =>
        svc.signEncounter({
          record,
          body: {
            mainDiagnosis: VALID_DX,
            recommendations: "Rest + ibuprofen",
          },
        }),
    );

    expect(signed.status).toBe("signed");
    expect(signed.signedAt).toBeInstanceOf(Date);
    expect(signed.mainDiagnosis.code).toBe("J45.1");
    expect(signed.recommendations).toBe("Rest + ibuprofen");

    // history must contain status transition
    const hasTransition = signed.history.some(
      (h) => h.changes?.field === "status" && h.changes?.newValue === "signed",
    );
    expect(hasTransition).toBe(true);
  });

  it("refuses to sign an already-signed encounter", async () => {
    const created = await runWithTenantContext(
      makeCtx({ clinicId: clinicA, userId: doctorA, role: "doctor" }),
      () => svc.createEncounter({ patient, body: FULL_BODY }),
    );

    const record = await NewPatientMedicalHistory.findById(created._id);

    await expect(
      runWithTenantContext(
        makeCtx({ clinicId: clinicA, userId: doctorA, role: "doctor" }),
        () => svc.signEncounter({ record, body: {} }),
      ),
    ).rejects.toThrow(/Cannot sign.*signed/i);
  });

  it("refuses to sign without diagnosis ever set", async () => {
    const draft = await runWithTenantContext(
      makeCtx({ clinicId: clinicA, userId: doctorA, role: "doctor" }),
      () => svc.createEncounter({ patient, body: { status: "draft" } }),
    );

    const record = await NewPatientMedicalHistory.findById(draft._id);

    await expect(
      runWithTenantContext(
        makeCtx({ clinicId: clinicA, userId: doctorA, role: "doctor" }),
        () => svc.signEncounter({ record, body: {} }),
      ),
    ).rejects.toThrow(/mainDiagnosis.*required/i);
  });
});

// ─── 3. AMEND ─────────────────────────────────────────────────────────

describe("amendEncounter", () => {
  let clinicA, doctorA, patient;

  beforeEach(() => {
    clinicA = oid();
    doctorA = oid();
    patient = fakePatient();
  });

  it("transitions signed → amended, captures reason + diff", async () => {
    const created = await runWithTenantContext(
      makeCtx({ clinicId: clinicA, userId: doctorA, role: "doctor" }),
      () =>
        svc.createEncounter({
          patient,
          body: {
            ...FULL_BODY,
            recommendations: "Initial advice",
          },
        }),
    );

    const record = await NewPatientMedicalHistory.findById(created._id);

    const amended = await runWithTenantContext(
      makeCtx({ clinicId: clinicA, userId: doctorA, role: "doctor" }),
      () =>
        svc.amendEncounter({
          record,
          body: {
            reason: "Updated medication after follow-up review",
            recommendations: "Switched to fluticasone inhaler",
          },
        }),
    );

    expect(amended.status).toBe("amended");
    expect(amended.recommendations).toBe("Switched to fluticasone inhaler");

    // history must have:
    //  - the recommendations diff entry
    //  - the _amendment_reason entry
    const recDiff = amended.history.find(
      (h) => h.changes?.field === "recommendations",
    );
    expect(recDiff?.changes?.oldValue).toBe("Initial advice");
    expect(recDiff?.changes?.newValue).toBe("Switched to fluticasone inhaler");

    const reasonEntry = amended.history.find(
      (h) => h.changes?.field === "_amendment_reason",
    );
    expect(reasonEntry?.changes?.newValue).toMatch(/follow-up/i);
  });

  it("refuses amend on draft", async () => {
    const draft = await runWithTenantContext(
      makeCtx({ clinicId: clinicA, userId: doctorA, role: "doctor" }),
      () => svc.createEncounter({ patient, body: { status: "draft" } }),
    );
    const record = await NewPatientMedicalHistory.findById(draft._id);

    await expect(
      runWithTenantContext(
        makeCtx({ clinicId: clinicA, userId: doctorA, role: "doctor" }),
        () =>
          svc.amendEncounter({
            record,
            body: { reason: "Some reason here" },
          }),
      ),
    ).rejects.toThrow(/Cannot amend.*draft/i);
  });

  it("requires reason min 5 chars", async () => {
    const created = await runWithTenantContext(
      makeCtx({ clinicId: clinicA, userId: doctorA, role: "doctor" }),
      () => svc.createEncounter({ patient, body: FULL_BODY }),
    );
    const record = await NewPatientMedicalHistory.findById(created._id);

    await expect(
      runWithTenantContext(
        makeCtx({ clinicId: clinicA, userId: doctorA, role: "doctor" }),
        () => svc.amendEncounter({ record, body: { reason: "no" } }),
      ),
    ).rejects.toThrow(/reason.*required.*5/i);
  });
});

// ─── 4. UPDATE ────────────────────────────────────────────────────────

describe("updateEncounter", () => {
  let clinicA, doctorA, patient;

  beforeEach(() => {
    clinicA = oid();
    doctorA = oid();
    patient = fakePatient();
  });

  it("edits draft content fields", async () => {
    const draft = await runWithTenantContext(
      makeCtx({ clinicId: clinicA, userId: doctorA, role: "doctor" }),
      () =>
        svc.createEncounter({
          patient,
          body: { status: "draft", complaints: "vague" },
        }),
    );
    const record = await NewPatientMedicalHistory.findById(draft._id);

    const updated = await runWithTenantContext(
      makeCtx({ clinicId: clinicA, userId: doctorA, role: "doctor" }),
      () =>
        svc.updateEncounter({
          record,
          body: { complaints: "Productive cough x 5d" },
        }),
    );

    expect(updated.complaints).toBe("Productive cough x 5d");
    expect(updated.status).toBe("draft"); // unchanged
  });

  it("refuses update on signed encounter (use amend instead)", async () => {
    const signed = await runWithTenantContext(
      makeCtx({ clinicId: clinicA, userId: doctorA, role: "doctor" }),
      () => svc.createEncounter({ patient, body: FULL_BODY }),
    );
    const record = await NewPatientMedicalHistory.findById(signed._id);

    await expect(
      runWithTenantContext(
        makeCtx({ clinicId: clinicA, userId: doctorA, role: "doctor" }),
        () =>
          svc.updateEncounter({
            record,
            body: { complaints: "something else" },
          }),
      ),
    ).rejects.toThrow(/Cannot update.*signed.*amend/i);
  });
});

// ─── 5. LIST + ACCESS CHAIN ───────────────────────────────────────────

describe("listEncountersForPatient — access chain", () => {
  let clinicA, clinicB, doctorA, doctorB, patient;

  beforeEach(async () => {
    clinicA = oid();
    clinicB = oid();
    doctorA = oid();
    doctorB = oid();
    patient = fakePatient();

    // ClinicA creates a signed encounter for this patient
    await runWithTenantContext(
      makeCtx({ clinicId: clinicA, userId: doctorA, role: "doctor" }),
      () => svc.createEncounter({ patient, body: FULL_BODY }),
    );
  });

  it("clinicB sees ZERO encounters of patient without consent", async () => {
    const result = await runWithTenantContext(
      makeCtx({ clinicId: clinicB, userId: doctorB, role: "doctor" }),
      () => svc.listEncountersForPatient({ patient, query: {} }),
    );

    expect(result.count).toBe(0);
    expect(result.items).toHaveLength(0);
  });

  it("clinicB sees clinicA encounter via global PatientConsent", async () => {
    // Patient grants consent to clinicB for encounters
    await PatientConsent.create({
      patientRef: patient._id,
      patientTypeModel: "ClinicPatient",
      clinicId: clinicB,
      purpose: "second_opinion",
      scopes: { encounters: true, allergies: false },
      signedAt: new Date(),
      signedByPatient: oid(),
      signatureMethod: "electronic",
    });

    const result = await runWithTenantContext(
      makeCtx({ clinicId: clinicB, userId: doctorB, role: "doctor" }),
      () => svc.listEncountersForPatient({ patient, query: {} }),
    );

    expect(result.count).toBe(1);
    expect(result.items[0].isCrossClinic).toBe(true);
  });

  it("clinicA always sees its own encounters", async () => {
    const result = await runWithTenantContext(
      makeCtx({ clinicId: clinicA, userId: doctorA, role: "doctor" }),
      () => svc.listEncountersForPatient({ patient, query: {} }),
    );

    expect(result.count).toBe(1);
    expect(result.items[0].isCrossClinic).toBeUndefined();
  });
});

// ─── 6. DELETE ────────────────────────────────────────────────────────

describe("deleteEncounter", () => {
  it("removes record (owner role required at routing layer)", async () => {
    const clinicA = oid();
    const ownerA = oid();
    const patient = fakePatient();

    const created = await runWithTenantContext(
      makeCtx({ clinicId: clinicA, userId: ownerA, role: "owner" }),
      () => svc.createEncounter({ patient, body: FULL_BODY }),
    );

    const record = await NewPatientMedicalHistory.findById(created._id);

    const result = await runWithTenantContext(
      makeCtx({ clinicId: clinicA, userId: ownerA, role: "owner" }),
      () => svc.deleteEncounter({ record }),
    );

    expect(result.deleted).toBe(true);

    const remaining = await NewPatientMedicalHistory.findById(created._id);
    expect(remaining).toBeNull();
  });
});
