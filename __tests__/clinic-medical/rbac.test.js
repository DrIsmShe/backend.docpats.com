// __tests__/clinic-medical/rbac.test.js
//
// Sanity tests for clinic-medical RBAC matrix.
// Sprint 2 Phase 2A — PATCHED in 2B:
//   admin no longer has ENCOUNTER.DELETE — aligned with ROLE_PERMISSIONS
//   where medical_record.delete is owner-only.
//   PATCHED: lab_technician role added to the matrix (10 roles total).
//
// Goal: catch matrix typos at CI time, BEFORE wrong permissions ship.
// HIPAA-critical: if matrix grants wrong access, real patient data leaks.

import { describe, it, expect } from "vitest";
import {
  RBAC_MATRIX,
  ACTIONS,
  ALL_CLINIC_MEDICAL_ACTIONS,
  canRolePerform,
  getRoleActions,
  isKnownRole,
} from "../../modules/clinic/clinic-medical/rbac/clinicMedicalRBAC.js";

describe("clinic-medical RBAC matrix — structure", () => {
  it("has all 10 roles", () => {
    const roles = Object.keys(RBAC_MATRIX).sort();
    expect(roles).toEqual([
      "accountant",
      "admin",
      "doctor",
      "lab_technician",
      "manager",
      "marketer",
      "nurse",
      "owner",
      "pharmacist",
      "receptionist",
    ]);
  });

  it("all matrix values are Sets", () => {
    for (const role of Object.keys(RBAC_MATRIX)) {
      expect(RBAC_MATRIX[role]).toBeInstanceOf(Set);
    }
  });

  it("every action in matrix is a known audit action", () => {
    const all = new Set(ALL_CLINIC_MEDICAL_ACTIONS);
    for (const role of Object.keys(RBAC_MATRIX)) {
      for (const action of RBAC_MATRIX[role]) {
        expect(all.has(action)).toBe(true);
      }
    }
  });
});

describe("clinic-medical RBAC — HIPAA boundary checks", () => {
  // These tests encode the SECURITY MODEL — if they fail, do not deploy.

  it("marketer has ZERO clinical access", () => {
    expect(getRoleActions("marketer")).toEqual([]);
  });

  it("accountant has ZERO clinical access", () => {
    expect(getRoleActions("accountant")).toEqual([]);
  });

  it("receptionist cannot read clinical PHI details (no encounter.READ)", () => {
    // Receptionist sees that an encounter exists (LIST) but does NOT see
    // diagnosis/notes/etc — server response should filter, but RBAC
    // also locks down READ explicitly.
    expect(canRolePerform("receptionist", ACTIONS.ENCOUNTER.READ)).toBe(false);
    expect(canRolePerform("receptionist", ACTIONS.ALLERGY.READ)).toBe(false);
  });

  it("nurse cannot create encounters (must be doctor)", () => {
    expect(canRolePerform("nurse", ACTIONS.ENCOUNTER.CREATE)).toBe(false);
    expect(canRolePerform("nurse", ACTIONS.ENCOUNTER.SIGN)).toBe(false);
    expect(canRolePerform("nurse", ACTIONS.ENCOUNTER.AMEND)).toBe(false);
  });

  it("nurse CAN manage anamnestic sub-records (allergies, immunization, family)", () => {
    expect(canRolePerform("nurse", ACTIONS.ALLERGY.CREATE)).toBe(true);
    expect(canRolePerform("nurse", ACTIONS.IMMUNIZATION.CREATE)).toBe(true);
    expect(canRolePerform("nurse", ACTIONS.FAMILY.CREATE)).toBe(true);
    expect(canRolePerform("nurse", ACTIONS.CHRONIC.CREATE)).toBe(true);
  });

  it("nurse cannot delete sub-records (audit trail required)", () => {
    expect(canRolePerform("nurse", ACTIONS.ALLERGY.DELETE)).toBe(false);
    expect(canRolePerform("nurse", ACTIONS.OPERATION.DELETE)).toBe(false);
  });

  it("doctor cannot delete encounters (only amend)", () => {
    expect(canRolePerform("doctor", ACTIONS.ENCOUNTER.DELETE)).toBe(false);
    expect(canRolePerform("doctor", ACTIONS.ENCOUNTER.AMEND)).toBe(true);
  });

  // PATCHED 2B: admin can NO LONGER delete encounters.
  // Aligned with ROLE_PERMISSIONS where medical_record.delete is owner-only.
  // Rationale: encounter is a legal clinical document; deletion is a
  // high-stakes audit-altering action reserved for the clinic owner.
  it("ONLY owner can delete encounters", () => {
    for (const role of Object.keys(RBAC_MATRIX)) {
      const expected = role === "owner";
      expect(canRolePerform(role, ACTIONS.ENCOUNTER.DELETE)).toBe(expected);
    }
  });

  // PATCHED 2B: admin still has everything doctor has — but NOT delete.
  it("admin can do everything doctor can (without delete)", () => {
    const doctorActions = getRoleActions("doctor");
    for (const action of doctorActions) {
      expect(canRolePerform("admin", action)).toBe(true);
    }
    // explicit negative for delete
    expect(canRolePerform("admin", ACTIONS.ENCOUNTER.DELETE)).toBe(false);
  });

  it("owner can do everything doctor can PLUS delete", () => {
    const doctorActions = getRoleActions("doctor");
    for (const action of doctorActions) {
      expect(canRolePerform("owner", action)).toBe(true);
    }
    expect(canRolePerform("owner", ACTIONS.ENCOUNTER.DELETE)).toBe(true);
  });

  it("pharmacist gets allergies + chronic + encounter read only", () => {
    expect(canRolePerform("pharmacist", ACTIONS.ALLERGY.READ)).toBe(true);
    expect(canRolePerform("pharmacist", ACTIONS.CHRONIC.READ)).toBe(true);
    expect(canRolePerform("pharmacist", ACTIONS.ENCOUNTER.READ)).toBe(true);
    // No writes
    expect(canRolePerform("pharmacist", ACTIONS.ALLERGY.CREATE)).toBe(false);
    expect(canRolePerform("pharmacist", ACTIONS.ENCOUNTER.CREATE)).toBe(false);
    // No imaging
    expect(canRolePerform("pharmacist", ACTIONS.IMAGING.READ)).toBe(false);
  });

  it("manager sees encounters list/read for ops but cannot write clinical", () => {
    expect(canRolePerform("manager", ACTIONS.ENCOUNTER.READ)).toBe(true);
    expect(canRolePerform("manager", ACTIONS.ENCOUNTER.LIST)).toBe(true);
    expect(canRolePerform("manager", ACTIONS.ENCOUNTER.CREATE)).toBe(false);
    expect(canRolePerform("manager", ACTIONS.ALLERGY.CREATE)).toBe(false);
    expect(canRolePerform("manager", ACTIONS.IMAGING.READ)).toBe(false);
  });
});

describe("clinic-medical RBAC — public API", () => {
  it("canRolePerform returns false for unknown role", () => {
    expect(canRolePerform("hacker", ACTIONS.ENCOUNTER.READ)).toBe(false);
    expect(canRolePerform(null, ACTIONS.ENCOUNTER.READ)).toBe(false);
    expect(canRolePerform("", ACTIONS.ENCOUNTER.READ)).toBe(false);
  });

  it("canRolePerform returns false for unknown action", () => {
    expect(canRolePerform("doctor", "lol.do.whatever")).toBe(false);
    expect(canRolePerform("doctor", null)).toBe(false);
    expect(canRolePerform("doctor", "")).toBe(false);
  });

  it("isKnownRole works", () => {
    expect(isKnownRole("doctor")).toBe(true);
    expect(isKnownRole("owner")).toBe(true);
    expect(isKnownRole("marketer")).toBe(true);
    expect(isKnownRole("hacker")).toBe(false);
    expect(isKnownRole(null)).toBe(false);
    expect(isKnownRole(undefined)).toBe(false);
  });

  it("getRoleActions returns sorted list", () => {
    const actions = getRoleActions("nurse");
    const sorted = [...actions].sort();
    expect(actions).toEqual(sorted);
  });

  it("getRoleActions returns [] for unknown role", () => {
    expect(getRoleActions("hacker")).toEqual([]);
  });
});
