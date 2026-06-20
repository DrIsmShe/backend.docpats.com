// server/__tests__/clinic-equipment/clinicEquipment.model.test.js
//
// Model-level tests: schema defaults, validation, partial-unique
// inventoryNumber index, tenant scoping at the raw-query level.
//
// Mongo connection + per-test cleanup come from __tests__/setup.js
// (global MongoMemoryReplSet). This file builds the partial-unique index
// once in beforeAll so the duplicate-number test isn't a false green.
//
// NOTE: ClinicEquipment is a DEFAULT export. EQUIPMENT_STATUSES and
// EQUIPMENT_CATEGORIES are named exports from the same module.

import { describe, it, expect, beforeAll } from "vitest";
import mongoose from "mongoose";

import ClinicEquipment, {
  EQUIPMENT_STATUSES,
  EQUIPMENT_CATEGORIES,
} from "../../modules/clinic/clinic-equipment/models/clinicEquipment.model.js";

const CLINIC_A = new mongoose.Types.ObjectId();
const CLINIC_B = new mongoose.Types.ObjectId();
const DEPT_A = new mongoose.Types.ObjectId();

beforeAll(async () => {
  await ClinicEquipment.syncIndexes();
});

describe("ClinicEquipment model — basics", () => {
  it("applies defaults (status=operational, category=other, roomId=null)", async () => {
    const eq = await ClinicEquipment.create({
      clinicId: CLINIC_A,
      departmentId: DEPT_A,
      name: "Аппарат УЗИ",
    });
    expect(eq.status).toBe("operational");
    expect(eq.category).toBe("other");
    expect(eq.roomId).toBeNull();
    expect(eq.inventoryNumber).toBeNull();
    expect(Array.isArray(eq.assignedMembershipIds)).toBe(true);
    expect(eq.assignedMembershipIds).toHaveLength(0);
  });

  it("uppercases and trims inventoryNumber", async () => {
    const eq = await ClinicEquipment.create({
      clinicId: CLINIC_A,
      departmentId: DEPT_A,
      name: "Дефибриллятор",
      inventoryNumber: "  inv-42  ",
    });
    expect(eq.inventoryNumber).toBe("INV-42");
  });

  it("exposes the status + category enum lists", () => {
    expect(EQUIPMENT_STATUSES).toContain("operational");
    expect(EQUIPMENT_STATUSES).toContain("archived");
    expect(EQUIPMENT_CATEGORIES).toContain("imaging");
    expect(EQUIPMENT_CATEGORIES).toContain("other");
  });
});

describe("ClinicEquipment model — validation (errors)", () => {
  it("requires name", async () => {
    await expect(
      ClinicEquipment.create({ clinicId: CLINIC_A, departmentId: DEPT_A }),
    ).rejects.toThrow(/name/i);
  });

  it("requires clinicId", async () => {
    await expect(
      ClinicEquipment.create({ departmentId: DEPT_A, name: "X" }),
    ).rejects.toThrow(/clinicId/i);
  });

  it("requires departmentId", async () => {
    await expect(
      ClinicEquipment.create({ clinicId: CLINIC_A, name: "X" }),
    ).rejects.toThrow(/departmentId/i);
  });

  it("rejects an invalid status", async () => {
    await expect(
      ClinicEquipment.create({
        clinicId: CLINIC_A,
        departmentId: DEPT_A,
        name: "X",
        status: "exploded",
      }),
    ).rejects.toThrow();
  });

  it("rejects an invalid category", async () => {
    await expect(
      ClinicEquipment.create({
        clinicId: CLINIC_A,
        departmentId: DEPT_A,
        name: "X",
        category: "banana",
      }),
    ).rejects.toThrow();
  });
});

describe("ClinicEquipment model — inventoryNumber uniqueness (partial index)", () => {
  it("rejects a duplicate inventoryNumber within the same clinic", async () => {
    await ClinicEquipment.create({
      clinicId: CLINIC_A,
      departmentId: DEPT_A,
      name: "Eq 1",
      inventoryNumber: "INV-100",
    });
    await expect(
      ClinicEquipment.create({
        clinicId: CLINIC_A,
        departmentId: DEPT_A,
        name: "Eq 2",
        inventoryNumber: "INV-100",
      }),
    ).rejects.toMatchObject({ code: 11000 });
  });

  it("allows the same inventoryNumber in different clinics", async () => {
    await ClinicEquipment.create({
      clinicId: CLINIC_A,
      departmentId: DEPT_A,
      name: "Eq A",
      inventoryNumber: "INV-100",
    });
    const eqB = await ClinicEquipment.create({
      clinicId: CLINIC_B,
      departmentId: DEPT_A,
      name: "Eq B",
      inventoryNumber: "INV-100",
    });
    expect(eqB.inventoryNumber).toBe("INV-100");
  });

  it("allows multiple equipment with no inventoryNumber (null) in one clinic", async () => {
    await ClinicEquipment.create({
      clinicId: CLINIC_A,
      departmentId: DEPT_A,
      name: "A",
    });
    const second = await ClinicEquipment.create({
      clinicId: CLINIC_A,
      departmentId: DEPT_A,
      name: "B",
    });
    expect(second._id).toBeDefined();
  });
});

describe("ClinicEquipment model — tenant isolation (raw queries)", () => {
  it("does not return another clinic's equipment", async () => {
    await ClinicEquipment.create({
      clinicId: CLINIC_A,
      departmentId: DEPT_A,
      name: "A-eq",
    });
    await ClinicEquipment.create({
      clinicId: CLINIC_B,
      departmentId: DEPT_A,
      name: "B-eq",
    });

    const aOnly = await ClinicEquipment.find({ clinicId: CLINIC_A });
    expect(aOnly).toHaveLength(1);
    expect(aOnly[0].name).toBe("A-eq");
  });
});
