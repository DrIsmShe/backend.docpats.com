import { describe, it, expect } from "vitest";
import {
  RESOURCES,
  ACTIONS,
  ROLES,
  ROLE_PERMISSIONS,
  getDefaultPermissionsForRole,
  getAllRoles,
  getAllResources,
} from "../../common/auth/permissions.js";
import {
  ROLE_HIERARCHY,
  getRoleLevel,
  canAssignRole,
  isAtLeastSeniorTo,
} from "../../common/auth/roleHierarchy.js";
import {
  can,
  require as requirePerm,
  canFor,
  requireFor,
} from "../../common/auth/can.js";
import { runWithTenantContext } from "../../common/context/tenantContext.js";

describe("permissions catalog", () => {
  it("RESOURCES is non-empty and frozen", () => {
    expect(getAllResources().length).toBeGreaterThan(20);
    expect(() => {
      RESOURCES.NEW_RESOURCE = "test";
    }).toThrow();
  });

  it("ROLES include 9 standard roles", () => {
    expect(getAllRoles().length).toBe(9);
    expect(getAllRoles()).toContain("owner");
    expect(getAllRoles()).toContain("doctor");
  });

  it("owner has FULL on every resource", () => {
    const ownerPerms = getDefaultPermissionsForRole(ROLES.OWNER);
    for (const resource of getAllResources()) {
      expect(ownerPerms[resource]?.read).toBe(true);
      expect(ownerPerms[resource]?.write).toBe(true);
      expect(ownerPerms[resource]?.delete).toBe(true);
    }
  });

  it("doctor has medical_record write", () => {
    const docPerms = getDefaultPermissionsForRole(ROLES.DOCTOR);
    expect(docPerms[RESOURCES.MEDICAL_RECORD].write).toBe(true);
  });

  it("doctor has no payroll access", () => {
    const docPerms = getDefaultPermissionsForRole(ROLES.DOCTOR);
    expect(docPerms[RESOURCES.PAYROLL]).toBeUndefined();
  });

  it("accountant has payroll FULL but no patient", () => {
    const accPerms = getDefaultPermissionsForRole(ROLES.ACCOUNTANT);
    expect(accPerms[RESOURCES.PAYROLL].write).toBe(true);
    expect(accPerms[RESOURCES.PATIENT]).toBeUndefined();
  });
});

describe("can() — context-aware", () => {
  it("returns false outside context", () => {
    expect(can("patient", "read")).toBe(false);
  });

  it("doctor can patient.write but not patient.delete", () => {
    runWithTenantContext(
      { userId: "u", clinicId: "c", role: ROLES.DOCTOR },
      () => {
        expect(can("patient", "read")).toBe(true);
        expect(can("patient", "write")).toBe(true);
        expect(can("patient", "delete")).toBe(false);
      },
    );
  });

  it("supports dot-notation", () => {
    runWithTenantContext(
      { userId: "u", clinicId: "c", role: ROLES.DOCTOR },
      () => {
        expect(can("medical_record.write")).toBe(true);
        expect(can("payroll.read")).toBe(false);
      },
    );
  });

  it("override permissions take precedence", () => {
    runWithTenantContext(
      {
        userId: "u",
        clinicId: "c",
        role: ROLES.DOCTOR,
        permissions: {
          payroll: { read: true, write: false, delete: false },
          patient: { read: false, write: false, delete: false },
        },
      },
      () => {
        expect(can("payroll", "read")).toBe(true); // override grants
        expect(can("patient", "read")).toBe(false); // override revokes
        expect(can("appointment", "write")).toBe(true); // role default
      },
    );
  });

  it("rejects invalid syntax", () => {
    expect(() => can("a.b.c")).toThrow();
  });
});

describe("require()", () => {
  it("throws ForbiddenError on denied", () => {
    runWithTenantContext(
      { userId: "u", clinicId: "c", role: ROLES.NURSE },
      () => {
        expect(() => requirePerm("payroll", "write")).toThrow();
        try {
          requirePerm("payroll", "write");
        } catch (e) {
          expect(e.code).toBe("FORBIDDEN");
          expect(e.status).toBe(403);
        }
      },
    );
  });

  it("does not throw on allowed", () => {
    runWithTenantContext(
      { userId: "u", clinicId: "c", role: ROLES.DOCTOR },
      () => {
        expect(() => requirePerm("patient", "read")).not.toThrow();
      },
    );
  });
});

describe("canFor() — without context", () => {
  it("works without AsyncLocalStorage context", () => {
    const membership = { role: ROLES.ACCOUNTANT, permissions: {} };
    expect(canFor(membership, "payroll", "write")).toBe(true);
    expect(canFor(membership, "patient", "read")).toBe(false);
  });

  it("returns false for null membership", () => {
    expect(canFor(null, "patient", "read")).toBe(false);
    expect(canFor({}, "patient", "read")).toBe(false);
  });

  it("requireFor throws like require", () => {
    const membership = { role: ROLES.NURSE, permissions: {} };
    expect(() => requireFor(membership, "payroll", "write")).toThrow();
  });
});

describe("role hierarchy", () => {
  it("levels are ordered", () => {
    expect(getRoleLevel(ROLES.OWNER)).toBeGreaterThan(
      getRoleLevel(ROLES.ADMIN),
    );
    expect(getRoleLevel(ROLES.ADMIN)).toBeGreaterThan(
      getRoleLevel(ROLES.DOCTOR),
    );
    expect(getRoleLevel(ROLES.DOCTOR)).toBeGreaterThan(
      getRoleLevel(ROLES.NURSE),
    );
    expect(getRoleLevel("unknown")).toBe(-1);
  });

  it("admin can assign doctor but not owner or admin", () => {
    expect(canAssignRole(ROLES.ADMIN, ROLES.DOCTOR)).toBe(true);
    expect(canAssignRole(ROLES.ADMIN, ROLES.OWNER)).toBe(false);
    expect(canAssignRole(ROLES.ADMIN, ROLES.ADMIN)).toBe(false);
  });

  it("nurse cannot assign doctor", () => {
    expect(canAssignRole(ROLES.NURSE, ROLES.DOCTOR)).toBe(false);
  });

  it("isAtLeastSeniorTo includes equal levels", () => {
    expect(isAtLeastSeniorTo(ROLES.ADMIN, ROLES.ADMIN)).toBe(true);
    expect(isAtLeastSeniorTo(ROLES.ADMIN, ROLES.DOCTOR)).toBe(true);
    expect(isAtLeastSeniorTo(ROLES.DOCTOR, ROLES.ADMIN)).toBe(false);
  });
});
