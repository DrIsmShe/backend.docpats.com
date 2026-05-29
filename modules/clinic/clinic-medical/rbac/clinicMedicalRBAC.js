// modules/clinic/clinic-medical/rbac/clinicMedicalRBAC.js
//
// Role-Based Access Control matrix for clinic-medical (UMR) module.
// Sprint 2 Phase 2A — patched in 2B to align with ROLE_PERMISSIONS:
//   admin no longer has ENCOUNTER.DELETE — only owner can delete encounters.

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

export const ALL_CLINIC_MEDICAL_ACTIONS = [
  ...Object.values(ENCOUNTER),
  ...Object.values(ALLERGY),
  ...Object.values(CHRONIC),
  ...Object.values(OPERATION),
  ...Object.values(FAMILY),
  ...Object.values(IMMUNIZATION),
  ...Object.values(IMAGING),
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
];

export const RBAC_MATRIX = Object.freeze({
  owner: new Set([...DOCTOR_FULL, ENCOUNTER.DELETE]),
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
});

export default {
  RBAC_MATRIX,
  ACTIONS,
  ALL_CLINIC_MEDICAL_ACTIONS,
  canRolePerform,
  getRoleActions,
  isKnownRole,
};
