// server/__tests__/clinic-departments/department.service.test.js
//
// Service-level tests: CRUD, archive rules, ensureGeneral idempotency,
// the cross-module assertDepartmentInClinic guard, and the MANDATORY
// tenant-isolation suite.
//
// Mongo connection + per-test cleanup come from __tests__/setup.js.
// The service takes clinicId as an explicit argument (no ALS context),
// so no tenantContext mocking is needed — just two clinic ids.

import { describe, it, expect, beforeAll } from "vitest";
import mongoose from "mongoose";

import { ClinicDepartment } from "../../modules/clinic/clinic-departments/models/clinicDepartment.model.js";
import * as svc from "../../modules/clinic/clinic-departments/services/department.service.js";

const CLINIC_A = new mongoose.Types.ObjectId();
const CLINIC_B = new mongoose.Types.ObjectId();

beforeAll(async () => {
  await ClinicDepartment.syncIndexes();
});

// ─── CREATE ───────────────────────────────────────────────
describe("createDepartment — basics", () => {
  it("creates with defaults", async () => {
    const dep = await svc.createDepartment(CLINIC_A, { name: "Неврология" });
    expect(dep.name).toBe("Неврология");
    expect(dep.specialty).toBe("general");
    expect(dep.status).toBe("active");
    expect(dep.isSystem).toBe(false);
    expect(String(dep.clinicId)).toBe(String(CLINIC_A));
  });

  it("accepts a valid parentDepartmentId in the same clinic", async () => {
    const parent = await svc.createDepartment(CLINIC_A, { name: "Хирургия" });
    const child = await svc.createDepartment(CLINIC_A, {
      name: "Нейрохирургия",
      parentDepartmentId: parent._id,
    });
    expect(String(child.parentDepartmentId)).toBe(String(parent._id));
  });
});

describe("createDepartment — errors", () => {
  it("rejects a duplicate code in the same clinic (ConflictError)", async () => {
    await svc.createDepartment(CLINIC_A, { name: "A", code: "NEURO" });
    await expect(
      svc.createDepartment(CLINIC_A, { name: "B", code: "NEURO" }),
    ).rejects.toThrow(/code already exists/i);
  });

  it("rejects a parentDepartmentId from another clinic", async () => {
    const foreign = await svc.createDepartment(CLINIC_B, { name: "Foreign" });
    await expect(
      svc.createDepartment(CLINIC_A, {
        name: "Child",
        parentDepartmentId: foreign._id,
      }),
    ).rejects.toThrow(/parentDepartmentId not found/i);
  });
});

// ─── LIST ─────────────────────────────────────────────────
describe("listDepartments", () => {
  it("returns only this clinic's departments", async () => {
    await svc.createDepartment(CLINIC_A, { name: "A1" });
    await svc.createDepartment(CLINIC_A, { name: "A2" });
    await svc.createDepartment(CLINIC_B, { name: "B1" });

    const list = await svc.listDepartments(CLINIC_A);
    expect(list).toHaveLength(2);
    expect(list.map((d) => d.name).sort()).toEqual(["A1", "A2"]);
  });

  it("filters by status", async () => {
    const d = await svc.createDepartment(CLINIC_A, { name: "ToArchive" });
    await svc.createDepartment(CLINIC_A, { name: "Active" });
    await svc.archiveDepartment(CLINIC_A, d._id);

    const active = await svc.listDepartments(CLINIC_A, { status: "active" });
    expect(active.map((x) => x.name)).toEqual(["Active"]);
  });

  it("search q matches name and treats input as literal (regex-safe)", async () => {
    await svc.createDepartment(CLINIC_A, { name: "Кардиология" });
    await svc.createDepartment(CLINIC_A, { name: "Неврология" });

    const hit = await svc.listDepartments(CLINIC_A, { q: "Кардио" });
    expect(hit).toHaveLength(1);

    // Regex metacharacters must not blow up or match everything.
    const none = await svc.listDepartments(CLINIC_A, { q: ".*" });
    expect(none).toHaveLength(0);
  });
});

// ─── GET / UPDATE ─────────────────────────────────────────
describe("getDepartmentById", () => {
  it("returns the department", async () => {
    const created = await svc.createDepartment(CLINIC_A, { name: "X" });
    const found = await svc.getDepartmentById(CLINIC_A, created._id);
    expect(found.name).toBe("X");
  });

  it("throws NotFound for an id outside the clinic", async () => {
    const created = await svc.createDepartment(CLINIC_A, { name: "X" });
    await expect(svc.getDepartmentById(CLINIC_B, created._id)).rejects.toThrow(
      /not found/i,
    );
  });
});

describe("updateDepartment", () => {
  it("updates the name", async () => {
    const created = await svc.createDepartment(CLINIC_A, { name: "Old" });
    const updated = await svc.updateDepartment(CLINIC_A, created._id, {
      name: "New",
    });
    expect(updated.name).toBe("New");
  });

  it("rejects a department being its own parent", async () => {
    const created = await svc.createDepartment(CLINIC_A, { name: "X" });
    await expect(
      svc.updateDepartment(CLINIC_A, created._id, {
        parentDepartmentId: created._id,
      }),
    ).rejects.toThrow(/its own parent/i);
  });

  it("enforces enum on update (runValidators)", async () => {
    const created = await svc.createDepartment(CLINIC_A, { name: "X" });
    await expect(
      svc.updateDepartment(CLINIC_A, created._id, { specialty: "banana" }),
    ).rejects.toThrow();
  });
});

// ─── SET HEAD ─────────────────────────────────────────────
describe("setDepartmentHead", () => {
  it("sets and unsets the head", async () => {
    const created = await svc.createDepartment(CLINIC_A, { name: "X" });
    const headId = new mongoose.Types.ObjectId();

    const withHead = await svc.setDepartmentHead(CLINIC_A, created._id, headId);
    expect(String(withHead.headMembershipId)).toBe(String(headId));

    const cleared = await svc.setDepartmentHead(CLINIC_A, created._id, null);
    expect(cleared.headMembershipId).toBeNull();
  });
});

// ─── ARCHIVE ──────────────────────────────────────────────
describe("archiveDepartment", () => {
  it("soft-archives (status=archived, record stays)", async () => {
    const created = await svc.createDepartment(CLINIC_A, { name: "X" });
    const archived = await svc.archiveDepartment(CLINIC_A, created._id);
    expect(archived.status).toBe("archived");

    const stillThere = await ClinicDepartment.findById(created._id);
    expect(stillThere).not.toBeNull();
  });

  it("blocks archiving the system department", async () => {
    const general = await svc.ensureGeneralDepartment(CLINIC_A);
    await expect(svc.archiveDepartment(CLINIC_A, general._id)).rejects.toThrow(
      /system department/i,
    );
  });

  it("nulls children's parent on archive", async () => {
    const parent = await svc.createDepartment(CLINIC_A, { name: "Parent" });
    const child = await svc.createDepartment(CLINIC_A, {
      name: "Child",
      parentDepartmentId: parent._id,
    });
    await svc.archiveDepartment(CLINIC_A, parent._id);

    const reloaded = await ClinicDepartment.findById(child._id);
    expect(reloaded.parentDepartmentId).toBeNull();
  });
});

// ─── ENSURE GENERAL ───────────────────────────────────────
describe("ensureGeneralDepartment", () => {
  it("creates the system General department when absent", async () => {
    const general = await svc.ensureGeneralDepartment(CLINIC_A);
    expect(general.isSystem).toBe(true);
    expect(general.specialty).toBe("general");
  });

  it("is idempotent (returns the existing one)", async () => {
    const first = await svc.ensureGeneralDepartment(CLINIC_A);
    const second = await svc.ensureGeneralDepartment(CLINIC_A);
    expect(String(second._id)).toBe(String(first._id));

    const count = await ClinicDepartment.countDocuments({
      clinicId: CLINIC_A,
      isSystem: true,
    });
    expect(count).toBe(1);
  });
});

// ─── CROSS-MODULE GUARD ───────────────────────────────────
describe("assertDepartmentInClinic", () => {
  it("returns null for a falsy departmentId (optional)", async () => {
    await expect(
      svc.assertDepartmentInClinic(CLINIC_A, null),
    ).resolves.toBeNull();
    await expect(
      svc.assertDepartmentInClinic(CLINIC_A, undefined),
    ).resolves.toBeNull();
  });

  it("resolves for a valid active department", async () => {
    const dep = await svc.createDepartment(CLINIC_A, { name: "X" });
    const id = await svc.assertDepartmentInClinic(CLINIC_A, dep._id);
    expect(String(id)).toBe(String(dep._id));
  });

  it("rejects a department from another clinic", async () => {
    const dep = await svc.createDepartment(CLINIC_B, { name: "Foreign" });
    await expect(
      svc.assertDepartmentInClinic(CLINIC_A, dep._id),
    ).rejects.toThrow(/not found in this clinic/i);
  });

  it("rejects an archived department", async () => {
    const dep = await svc.createDepartment(CLINIC_A, { name: "X" });
    await svc.archiveDepartment(CLINIC_A, dep._id);
    await expect(
      svc.assertDepartmentInClinic(CLINIC_A, dep._id),
    ).rejects.toThrow(/archived|not found/i);
  });
});

// ─── MANDATORY TENANT ISOLATION ───────────────────────────
describe("tenant isolation (mandatory)", () => {
  it("clinic A cannot read clinic B's department", async () => {
    const depB = await svc.createDepartment(CLINIC_B, { name: "B-secret" });
    await expect(svc.getDepartmentById(CLINIC_A, depB._id)).rejects.toThrow(
      /not found/i,
    );
  });

  it("clinic A cannot update clinic B's department", async () => {
    const depB = await svc.createDepartment(CLINIC_B, { name: "B" });
    await expect(
      svc.updateDepartment(CLINIC_A, depB._id, { name: "hacked" }),
    ).rejects.toThrow(/not found/i);

    const untouched = await ClinicDepartment.findById(depB._id);
    expect(untouched.name).toBe("B");
  });

  it("clinic A cannot archive clinic B's department", async () => {
    const depB = await svc.createDepartment(CLINIC_B, { name: "B" });
    await expect(svc.archiveDepartment(CLINIC_A, depB._id)).rejects.toThrow(
      /not found/i,
    );

    const untouched = await ClinicDepartment.findById(depB._id);
    expect(untouched.status).toBe("active");
  });
});
