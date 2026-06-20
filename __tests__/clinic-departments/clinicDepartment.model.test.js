// server/__tests__/clinic-departments/clinicDepartment.model.test.js
//
// Model-level tests: schema defaults, validation, partial-unique code
// index, tenant scoping at the raw-query level.
//
// Mongo connection + per-test cleanup come from __tests__/setup.js
// (global MongoMemoryReplSet). This file only builds the partial-unique
// index once, so the duplicate-code test isn't a false green.

import { describe, it, expect, beforeAll } from "vitest";
import mongoose from "mongoose";

import {
  ClinicDepartment,
  DEPARTMENT_SPECIALTIES,
} from "../../modules/clinic/clinic-departments/models/clinicDepartment.model.js";

const CLINIC_A = new mongoose.Types.ObjectId();
const CLINIC_B = new mongoose.Types.ObjectId();

// Build { clinicId, code } partial-unique index so uniqueness actually fires.
beforeAll(async () => {
  await ClinicDepartment.syncIndexes();
});

describe("ClinicDepartment model — basics", () => {
  it("applies defaults (specialty=general, status=active, isSystem=false)", async () => {
    const dep = await ClinicDepartment.create({
      clinicId: CLINIC_A,
      name: "Неврология",
    });
    expect(dep.specialty).toBe("general");
    expect(dep.status).toBe("active");
    expect(dep.isSystem).toBe(false);
    expect(dep.parentDepartmentId).toBeNull();
    expect(dep.headMembershipId).toBeNull();
  });

  it("uppercases and trims code", async () => {
    const dep = await ClinicDepartment.create({
      clinicId: CLINIC_A,
      name: "ЛОР",
      code: "  ent  ",
    });
    expect(dep.code).toBe("ENT");
  });

  it("exposes the specialty enum list", () => {
    expect(DEPARTMENT_SPECIALTIES).toContain("ent");
    expect(DEPARTMENT_SPECIALTIES).toContain("general");
  });
});

describe("ClinicDepartment model — validation (errors)", () => {
  it("requires name", async () => {
    await expect(
      ClinicDepartment.create({ clinicId: CLINIC_A }),
    ).rejects.toThrow(/name/i);
  });

  it("requires clinicId", async () => {
    await expect(ClinicDepartment.create({ name: "X" })).rejects.toThrow(
      /clinicId/i,
    );
  });

  it("rejects an unknown specialty", async () => {
    await expect(
      ClinicDepartment.create({
        clinicId: CLINIC_A,
        name: "X",
        specialty: "banana",
      }),
    ).rejects.toThrow();
  });

  it("rejects an invalid status", async () => {
    await expect(
      ClinicDepartment.create({
        clinicId: CLINIC_A,
        name: "X",
        status: "deleted",
      }),
    ).rejects.toThrow();
  });
});

describe("ClinicDepartment model — code uniqueness (partial index)", () => {
  it("rejects a duplicate code within the same clinic", async () => {
    await ClinicDepartment.create({
      clinicId: CLINIC_A,
      name: "Неврология",
      code: "NEURO",
    });
    await expect(
      ClinicDepartment.create({
        clinicId: CLINIC_A,
        name: "Неврология 2",
        code: "NEURO",
      }),
    ).rejects.toMatchObject({ code: 11000 });
  });

  it("allows the same code in different clinics", async () => {
    await ClinicDepartment.create({
      clinicId: CLINIC_A,
      name: "Неврология",
      code: "NEURO",
    });
    const depB = await ClinicDepartment.create({
      clinicId: CLINIC_B,
      name: "Neurology",
      code: "NEURO",
    });
    expect(depB.code).toBe("NEURO");
  });

  it("allows multiple departments with no code (null) in one clinic", async () => {
    await ClinicDepartment.create({ clinicId: CLINIC_A, name: "A" });
    const second = await ClinicDepartment.create({
      clinicId: CLINIC_A,
      name: "B",
    });
    expect(second._id).toBeDefined();
  });
});

describe("ClinicDepartment model — tenant isolation (raw queries)", () => {
  it("does not return another clinic's departments", async () => {
    await ClinicDepartment.create({ clinicId: CLINIC_A, name: "A-dept" });
    await ClinicDepartment.create({ clinicId: CLINIC_B, name: "B-dept" });

    const aOnly = await ClinicDepartment.find({ clinicId: CLINIC_A });
    expect(aOnly).toHaveLength(1);
    expect(aOnly[0].name).toBe("A-dept");
  });
});
