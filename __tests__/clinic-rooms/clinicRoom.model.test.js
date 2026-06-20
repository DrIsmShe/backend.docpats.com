// server/__tests__/clinic-rooms/clinicRoom.model.test.js
//
// Model-level tests: schema defaults, validation, partial-unique code
// index, tenant scoping at the raw-query level.
//
// Mongo connection + per-test cleanup come from __tests__/setup.js
// (global MongoMemoryReplSet). This file builds the partial-unique index
// once in beforeAll so the duplicate-code test isn't a false green.
//
// NOTE: ClinicRoom is a DEFAULT export (unlike ClinicDepartment which is
// named). ROOM_STATUSES is a named export from the same module.

import { describe, it, expect, beforeAll } from "vitest";
import mongoose from "mongoose";

import ClinicRoom, {
  ROOM_STATUSES,
} from "../../modules/clinic/clinic-rooms/models/clinicRoom.model.js";

const CLINIC_A = new mongoose.Types.ObjectId();
const CLINIC_B = new mongoose.Types.ObjectId();
const DEPT_A = new mongoose.Types.ObjectId();

beforeAll(async () => {
  await ClinicRoom.syncIndexes();
});

describe("ClinicRoom model — basics", () => {
  it("applies defaults (status=active, capacity=null, assigned=[])", async () => {
    const room = await ClinicRoom.create({
      clinicId: CLINIC_A,
      departmentId: DEPT_A,
      name: "Кабинет №12",
    });
    expect(room.status).toBe("active");
    expect(room.capacity).toBeNull();
    expect(room.code).toBeNull();
    expect(room.floor).toBeNull();
    expect(Array.isArray(room.assignedMembershipIds)).toBe(true);
    expect(room.assignedMembershipIds).toHaveLength(0);
  });

  it("uppercases and trims code", async () => {
    const room = await ClinicRoom.create({
      clinicId: CLINIC_A,
      departmentId: DEPT_A,
      name: "Смотровая",
      code: "  or-3  ",
    });
    expect(room.code).toBe("OR-3");
  });

  it("exposes the status enum list", () => {
    expect(ROOM_STATUSES).toContain("active");
    expect(ROOM_STATUSES).toContain("archived");
  });
});

describe("ClinicRoom model — validation (errors)", () => {
  it("requires name", async () => {
    await expect(
      ClinicRoom.create({ clinicId: CLINIC_A, departmentId: DEPT_A }),
    ).rejects.toThrow(/name/i);
  });

  it("requires clinicId", async () => {
    await expect(
      ClinicRoom.create({ departmentId: DEPT_A, name: "X" }),
    ).rejects.toThrow(/clinicId/i);
  });

  it("requires departmentId", async () => {
    await expect(
      ClinicRoom.create({ clinicId: CLINIC_A, name: "X" }),
    ).rejects.toThrow(/departmentId/i);
  });

  it("rejects an invalid status", async () => {
    await expect(
      ClinicRoom.create({
        clinicId: CLINIC_A,
        departmentId: DEPT_A,
        name: "X",
        status: "deleted",
      }),
    ).rejects.toThrow();
  });

  it("rejects a negative capacity", async () => {
    await expect(
      ClinicRoom.create({
        clinicId: CLINIC_A,
        departmentId: DEPT_A,
        name: "X",
        capacity: -1,
      }),
    ).rejects.toThrow();
  });
});

describe("ClinicRoom model — code uniqueness (partial index)", () => {
  it("rejects a duplicate code within the same clinic", async () => {
    await ClinicRoom.create({
      clinicId: CLINIC_A,
      departmentId: DEPT_A,
      name: "Room 1",
      code: "R12",
    });
    await expect(
      ClinicRoom.create({
        clinicId: CLINIC_A,
        departmentId: DEPT_A,
        name: "Room 2",
        code: "R12",
      }),
    ).rejects.toMatchObject({ code: 11000 });
  });

  it("allows the same code in different clinics", async () => {
    await ClinicRoom.create({
      clinicId: CLINIC_A,
      departmentId: DEPT_A,
      name: "Room A",
      code: "R12",
    });
    const roomB = await ClinicRoom.create({
      clinicId: CLINIC_B,
      departmentId: DEPT_A,
      name: "Room B",
      code: "R12",
    });
    expect(roomB.code).toBe("R12");
  });

  it("allows multiple rooms with no code (null) in one clinic", async () => {
    await ClinicRoom.create({
      clinicId: CLINIC_A,
      departmentId: DEPT_A,
      name: "A",
    });
    const second = await ClinicRoom.create({
      clinicId: CLINIC_A,
      departmentId: DEPT_A,
      name: "B",
    });
    expect(second._id).toBeDefined();
  });
});

describe("ClinicRoom model — tenant isolation (raw queries)", () => {
  it("does not return another clinic's rooms", async () => {
    await ClinicRoom.create({
      clinicId: CLINIC_A,
      departmentId: DEPT_A,
      name: "A-room",
    });
    await ClinicRoom.create({
      clinicId: CLINIC_B,
      departmentId: DEPT_A,
      name: "B-room",
    });

    const aOnly = await ClinicRoom.find({ clinicId: CLINIC_A });
    expect(aOnly).toHaveLength(1);
    expect(aOnly[0].name).toBe("A-room");
  });
});
