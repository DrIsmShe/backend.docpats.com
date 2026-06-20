// modules/clinic/clinic-medical/rbac/clinicMedicalRBAC.js
//
// Role-Based Access Control matrix for clinic-medical (UMR) module.
// Sprint 2 Phase 2A — patched in 2B to align with ROLE_PERMISSIONS:
//   admin no longer has ENCOUNTER.DELETE — only owner can delete encounters.
// Stage 2 #4 — added PRESCRIPTION actions (admin/doctor issue, owner deletes,
//   nurse/pharmacist read-only).
// Stage 2 #A — added LAB_RESULT actions (doctor/admin create+update+export,
//   owner deletes, nurse read, pharmacist read, lab_technician create+read).

const ENCOUNTER = {
  CREATE: "clinic.medical.encounter.create",
  READ: "clinic.medical.encounter.read",
  LIST: "clinic.medical.encounter.list",
  UPDATE: "clinic.medical.encounter.update",
  SIGN: "clinic.medical.encounter.sign",
  AMEND: "clinic.medical.encounter.amend",
  DELETE: "clinic.medical.encounter.delete",
  EXPORT: "clinic.medical.encounter.export",
};

const ALLERGY = {
  CREATE: "clinic.medical.allergy.create",
  READ: "clinic.medical.allergy.read",
  LIST: "clinic.medical.allergy.list",
  UPDATE: "clinic.medical.allergy.update",
  DELETE: "clinic.medical.allergy.delete",
};

const CHRONIC = {
  CREATE: "clinic.medical.chronic_disease.create",
  READ: "clinic.medical.chronic_disease.read",
  LIST: "clinic.medical.chronic_disease.list",
  UPDATE: "clinic.medical.chronic_disease.update",
  DELETE: "clinic.medical.chronic_disease.delete",
};

const OPERATION = {
  CREATE: "clinic.medical.operation.create",
  READ: "clinic.medical.operation.read",
  LIST: "clinic.medical.operation.list",
  UPDATE: "clinic.medical.operation.update",
  DELETE: "clinic.medical.operation.delete",
};

const FAMILY = {
  CREATE: "clinic.medical.family_history.create",
  READ: "clinic.medical.family_history.read",
  LIST: "clinic.medical.family_history.list",
  UPDATE: "clinic.medical.family_history.update",
  DELETE: "clinic.medical.family_history.delete",
};

const IMMUNIZATION = {
  CREATE: "clinic.medical.immunization.create",
  READ: "clinic.medical.immunization.read",
  LIST: "clinic.medical.immunization.list",
  UPDATE: "clinic.medical.immunization.update",
  DELETE: "clinic.medical.immunization.delete",
};

const IMAGING = {
  CREATE: "clinic.medical.imaging.create",
  READ: "clinic.medical.imaging.read",
  LIST: "clinic.medical.imaging.list",
  UPDATE: "clinic.medical.imaging.update",
  DELETE: "clinic.medical.imaging.delete",
  EXPORT: "clinic.medical.imaging.export",
};

// ── Stage 2 #4 — Prescriptions ───────────────────────────────────
const PRESCRIPTION = {
  CREATE: "clinic.medical.prescription.create",
  READ: "clinic.medical.prescription.read",
  LIST: "clinic.medical.prescription.list",
  CANCEL: "clinic.medical.prescription.cancel",
  COMPLETE: "clinic.medical.prescription.complete",
  DELETE: "clinic.medical.prescription.delete",
  EXPORT: "clinic.medical.prescription.export", // PDF
};

// ── Stage 2 #A — Lab Results ─────────────────────────────────────
const LAB_RESULT = {
  CREATE: "clinic.medical.lab_result.create",
  READ: "clinic.medical.lab_result.read",
  LIST: "clinic.medical.lab_result.list",
  UPDATE: "clinic.medical.lab_result.update", // status FSM + comments
  DELETE: "clinic.medical.lab_result.delete",
  EXPORT: "clinic.medical.lab_result.export", // PDF
};

export const ALL_CLINIC_MEDICAL_ACTIONS = [
  ...Object.values(ENCOUNTER),
  ...Object.values(ALLERGY),
  ...Object.values(CHRONIC),
  ...Object.values(OPERATION),
  ...Object.values(FAMILY),
  ...Object.values(IMMUNIZATION),
  ...Object.values(IMAGING),
  ...Object.values(PRESCRIPTION),
  ...Object.values(LAB_RESULT),
];

const DOCTOR_FULL = [
  ENCOUNTER.CREATE,
  ENCOUNTER.READ,
  ENCOUNTER.LIST,
  ENCOUNTER.UPDATE,
  ENCOUNTER.SIGN,
  ENCOUNTER.AMEND,
  ENCOUNTER.EXPORT,
  ALLERGY.CREATE,
  ALLERGY.READ,
  ALLERGY.LIST,
  ALLERGY.UPDATE,
  ALLERGY.DELETE,
  CHRONIC.CREATE,
  CHRONIC.READ,
  CHRONIC.LIST,
  CHRONIC.UPDATE,
  CHRONIC.DELETE,
  OPERATION.CREATE,
  OPERATION.READ,
  OPERATION.LIST,
  OPERATION.UPDATE,
  OPERATION.DELETE,
  FAMILY.CREATE,
  FAMILY.READ,
  FAMILY.LIST,
  FAMILY.UPDATE,
  FAMILY.DELETE,
  IMMUNIZATION.CREATE,
  IMMUNIZATION.READ,
  IMMUNIZATION.LIST,
  IMMUNIZATION.UPDATE,
  IMMUNIZATION.DELETE,
  IMAGING.CREATE,
  IMAGING.READ,
  IMAGING.LIST,
  IMAGING.UPDATE,
  IMAGING.DELETE,
  IMAGING.EXPORT,
  // Prescriptions — врач выписывает полностью, кроме DELETE (только owner)
  PRESCRIPTION.CREATE,
  PRESCRIPTION.READ,
  PRESCRIPTION.LIST,
  PRESCRIPTION.CANCEL,
  PRESCRIPTION.COMPLETE,
  PRESCRIPTION.EXPORT,
  // Lab Results — врач выписывает полностью, кроме DELETE (только owner)
  LAB_RESULT.CREATE,
  LAB_RESULT.READ,
  LAB_RESULT.LIST,
  LAB_RESULT.UPDATE,
  LAB_RESULT.EXPORT,
];

export const RBAC_MATRIX = Object.freeze({
  owner: new Set([
    ...DOCTOR_FULL,
    ENCOUNTER.DELETE,
    PRESCRIPTION.DELETE,
    LAB_RESULT.DELETE,
  ]),
  admin: new Set(DOCTOR_FULL),
  doctor: new Set(DOCTOR_FULL),
  manager: new Set([ENCOUNTER.READ, ENCOUNTER.LIST]),
  nurse: new Set([
    ENCOUNTER.READ,
    ENCOUNTER.LIST,
    ALLERGY.CREATE,
    ALLERGY.READ,
    ALLERGY.LIST,
    ALLERGY.UPDATE,
    CHRONIC.CREATE,
    CHRONIC.READ,
    CHRONIC.LIST,
    CHRONIC.UPDATE,
    IMMUNIZATION.CREATE,
    IMMUNIZATION.READ,
    IMMUNIZATION.LIST,
    IMMUNIZATION.UPDATE,
    FAMILY.CREATE,
    FAMILY.READ,
    FAMILY.LIST,
    FAMILY.UPDATE,
    OPERATION.READ,
    OPERATION.LIST,
    IMAGING.READ,
    IMAGING.LIST,
    // Рецепты — медсестра видит назначения пациента, но не выписывает
    PRESCRIPTION.READ,
    PRESCRIPTION.LIST,
    // Анализы — медсестра видит результаты
    LAB_RESULT.READ,
    LAB_RESULT.LIST,
  ]),
  receptionist: new Set([ENCOUNTER.LIST]),
  accountant: new Set(),
  pharmacist: new Set([
    ALLERGY.READ,
    ALLERGY.LIST,
    CHRONIC.READ,
    CHRONIC.LIST,
    ENCOUNTER.READ,
    ENCOUNTER.LIST,
    // Рецепты — основная работа фармацевта (отпуск препаратов)
    PRESCRIPTION.READ,
    PRESCRIPTION.LIST,
    // Анализы — фармацевт может видеть (взаимодействия/дозировки)
    LAB_RESULT.READ,
    LAB_RESULT.LIST,
  ]),
  // Лаборант — заносит и читает анализы; ничего больше из медкарты
  lab_technician: new Set([
    LAB_RESULT.CREATE,
    LAB_RESULT.READ,
    LAB_RESULT.LIST,
    LAB_RESULT.UPDATE,
    LAB_RESULT.EXPORT,
    ENCOUNTER.READ,
    ENCOUNTER.LIST,
  ]),
  marketer: new Set(),
});

export function canRolePerform(role, action) {
  if (!role || !action) return false;
  const allowedSet = RBAC_MATRIX[role];
  if (!allowedSet) return false;
  return allowedSet.has(action);
}

export function getRoleActions(role) {
  const set = RBAC_MATRIX[role];
  if (!set) return [];
  return Array.from(set).sort();
}

export function isKnownRole(role) {
  return Boolean(role && RBAC_MATRIX[role]);
}

export const ACTIONS = Object.freeze({
  ENCOUNTER,
  ALLERGY,
  CHRONIC,
  OPERATION,
  FAMILY,
  IMMUNIZATION,
  IMAGING,
  PRESCRIPTION,
  LAB_RESULT,
});

export default {
  RBAC_MATRIX,
  ACTIONS,
  ALL_CLINIC_MEDICAL_ACTIONS,
  canRolePerform,
  getRoleActions,
  isKnownRole,
};
