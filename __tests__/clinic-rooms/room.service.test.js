// server/__tests__/clinic-rooms/room.service.test.js
//
// Service-level tests: CRUD, code-uniqueness conflicts, departmentId
// validation (via assertDepartmentInClinic), assignedMembershipIds
// validation (via ClinicMembership), soft-archive, the cross-module
// assertRoomInClinic guard, and the MANDATORY tenant-isolation suite.
//
// Mongo connection + per-test cleanup come from __tests__/setup.js.
// The room service takes clinicId as an explicit argument (no ALS
// context), exactly like department.service — so no tenantContext mock.
//
// Real ClinicDepartment + ClinicMembership documents are created as
// fixtures because the service validates against them in the database
// (a room must belong to an ACTIVE department of the clinic; assigned
// members must belong to the clinic).

import { describe, it, expect, beforeAll } from "vitest";
import mongoose from "mongoose";

import ClinicRoom from "../../modules/clinic/clinic-rooms/models/clinicRoom.model.js";
import * as svc from "../../modules/clinic/clinic-rooms/services/room.service.js";
import * as deptSvc from "../../modules/clinic/clinic-departments/services/department.service.js";
import ClinicMembership from "../../modules/clinic/clinic-staff/models/clinicMembership.model.js";

const CLINIC_A = new mongoose.Types.ObjectId();
const CLINIC_B = new mongoose.Types.ObjectId();

beforeAll(async () => {
  await ClinicRoom.syncIndexes();
});

// ─── fixtures ─────────────────────────────────────────────
//
// A fresh active department in the given clinic.
async function makeDept(clinicId, name = "Неврология") {
  return deptSvc.createDepartment(clinicId, { name });
}

// A membership belonging to the given clinic (minimal required fields:
// userId + clinicId + role).
async function makeMembership(clinicId, role = "doctor") {
  return ClinicMembership.create({
    userId: new mongoose.Types.ObjectId(),
    clinicId,
    role,
  });
}

// ─── CREATE ───────────────────────────────────────────────
describe("createRoom — basics", () => {
  it("creates with defaults and links to the department", async () => {
    const dept = await makeDept(CLINIC_A);
    const room = await svc.createRoom(CLINIC_A, {
      departmentId: dept._id,
      name: "Кабинет №12",
    });
    expect(room.name).toBe("Кабинет №12");
    expect(room.status).toBe("active");
    expect(String(room.clinicId)).toBe(String(CLINIC_A));
    expect(String(room.departmentId)).toBe(String(dept._id));
    expect(room.assignedMembershipIds).toEqual([]);
  });

  it("accepts optional fields (code, floor, capacity, notes)", async () => {
    const dept = await makeDept(CLINIC_A);
    const room = await svc.createRoom(CLINIC_A, {
      departmentId: dept._id,
      name: "Смотровая 3",
      code: "OR-3",
      floor: "2",
      capacity: 4,
      notes: "Угловой кабинет",
    });
    expect(room.code).toBe("OR-3");
    expect(room.floor).toBe("2");
    expect(room.capacity).toBe(4);
    expect(room.notes).toBe("Угловой кабинет");
  });

  it("assigns valid memberships and de-duplicates them", async () => {
    const dept = await makeDept(CLINIC_A);
    const m1 = await makeMembership(CLINIC_A);
    const m2 = await makeMembership(CLINIC_A);

    const room = await svc.createRoom(CLINIC_A, {
      departmentId: dept._id,
      name: "Shared",
      // duplicate m1 to exercise de-dup
      assignedMembershipIds: [m1._id, m2._id, m1._id],
    });
    expect(room.assignedMembershipIds).toHaveLength(2);
    expect(room.assignedMembershipIds.sort()).toEqual(
      [String(m1._id), String(m2._id)].sort(),
    );
  });
});

describe("createRoom — errors", () => {
  it("requires a departmentId (rejects null)", async () => {
    await expect(svc.createRoom(CLINIC_A, { name: "No dept" })).rejects.toThrow(
      /department/i,
    );
  });

  it("rejects a departmentId from another clinic", async () => {
    const foreignDept = await makeDept(CLINIC_B, "Foreign");
    await expect(
      svc.createRoom(CLINIC_A, {
        departmentId: foreignDept._id,
        name: "X",
      }),
    ).rejects.toThrow(/not found in this clinic|department/i);
  });

  it("rejects an archived department", async () => {
    const dept = await makeDept(CLINIC_A);
    await deptSvc.archiveDepartment(CLINIC_A, dept._id);
    await expect(
      svc.createRoom(CLINIC_A, { departmentId: dept._id, name: "X" }),
    ).rejects.toThrow(/archived|not found/i);
  });

  it("rejects a duplicate code in the same clinic (ConflictError)", async () => {
    const dept = await makeDept(CLINIC_A);
    await svc.createRoom(CLINIC_A, {
      departmentId: dept._id,
      name: "A",
      code: "R12",
    });
    await expect(
      svc.createRoom(CLINIC_A, {
        departmentId: dept._id,
        name: "B",
        code: "R12",
      }),
    ).rejects.toThrow(/code already exists/i);
  });

  it("rejects an assigned membership from another clinic", async () => {
    const dept = await makeDept(CLINIC_A);
    const foreignMember = await makeMembership(CLINIC_B);
    await expect(
      svc.createRoom(CLINIC_A, {
        departmentId: dept._id,
        name: "X",
        assignedMembershipIds: [foreignMember._id],
      }),
    ).rejects.toThrow(/do not belong to this clinic/i);
  });

  it("rejects a non-existent membership id", async () => {
    const dept = await makeDept(CLINIC_A);
    await expect(
      svc.createRoom(CLINIC_A, {
        departmentId: dept._id,
        name: "X",
        assignedMembershipIds: [new mongoose.Types.ObjectId()],
      }),
    ).rejects.toThrow(/do not belong to this clinic/i);
  });
});

// ─── LIST ─────────────────────────────────────────────────
describe("listRooms", () => {
  it("returns only this clinic's rooms", async () => {
    const dA = await makeDept(CLINIC_A);
    const dB = await makeDept(CLINIC_B);
    await svc.createRoom(CLINIC_A, { departmentId: dA._id, name: "A1" });
    await svc.createRoom(CLINIC_A, { departmentId: dA._id, name: "A2" });
    await svc.createRoom(CLINIC_B, { departmentId: dB._id, name: "B1" });

    const list = await svc.listRooms(CLINIC_A);
    expect(list).toHaveLength(2);
    expect(list.map((r) => r.name).sort()).toEqual(["A1", "A2"]);
  });

  it("filters by departmentId", async () => {
    const d1 = await makeDept(CLINIC_A, "Dept1");
    const d2 = await makeDept(CLINIC_A, "Dept2");
    await svc.createRoom(CLINIC_A, { departmentId: d1._id, name: "In1" });
    await svc.createRoom(CLINIC_A, { departmentId: d2._id, name: "In2" });

    const only1 = await svc.listRooms(CLINIC_A, { departmentId: d1._id });
    expect(only1.map((r) => r.name)).toEqual(["In1"]);
  });

  it("filters by status", async () => {
    const d = await makeDept(CLINIC_A);
    const r = await svc.createRoom(CLINIC_A, {
      departmentId: d._id,
      name: "ToArchive",
    });
    await svc.createRoom(CLINIC_A, { departmentId: d._id, name: "Active" });
    await svc.archiveRoom(CLINIC_A, r._id);

    const active = await svc.listRooms(CLINIC_A, { status: "active" });
    expect(active.map((x) => x.name)).toEqual(["Active"]);
  });
});

// ─── GET ──────────────────────────────────────────────────
describe("getRoomById", () => {
  it("returns the room", async () => {
    const d = await makeDept(CLINIC_A);
    const created = await svc.createRoom(CLINIC_A, {
      departmentId: d._id,
      name: "X",
    });
    const found = await svc.getRoomById(CLINIC_A, created._id);
    expect(found.name).toBe("X");
  });

  it("throws NotFound for an id outside the clinic", async () => {
    const d = await makeDept(CLINIC_A);
    const created = await svc.createRoom(CLINIC_A, {
      departmentId: d._id,
      name: "X",
    });
    await expect(svc.getRoomById(CLINIC_B, created._id)).rejects.toThrow(
      /not found/i,
    );
  });
});

// ─── UPDATE ───────────────────────────────────────────────
describe("updateRoom", () => {
  it("updates simple fields", async () => {
    const d = await makeDept(CLINIC_A);
    const created = await svc.createRoom(CLINIC_A, {
      departmentId: d._id,
      name: "Old",
    });
    const updated = await svc.updateRoom(CLINIC_A, created._id, {
      name: "New",
      floor: "3",
      capacity: 2,
    });
    expect(updated.name).toBe("New");
    expect(updated.floor).toBe("3");
    expect(updated.capacity).toBe(2);
  });

  it("moves a room to another valid department", async () => {
    const d1 = await makeDept(CLINIC_A, "D1");
    const d2 = await makeDept(CLINIC_A, "D2");
    const created = await svc.createRoom(CLINIC_A, {
      departmentId: d1._id,
      name: "X",
    });
    const moved = await svc.updateRoom(CLINIC_A, created._id, {
      departmentId: d2._id,
    });
    expect(String(moved.departmentId)).toBe(String(d2._id));
  });

  it("rejects moving a room to a foreign department", async () => {
    const dA = await makeDept(CLINIC_A);
    const dForeign = await makeDept(CLINIC_B, "Foreign");
    const created = await svc.createRoom(CLINIC_A, {
      departmentId: dA._id,
      name: "X",
    });
    await expect(
      svc.updateRoom(CLINIC_A, created._id, { departmentId: dForeign._id }),
    ).rejects.toThrow(/not found in this clinic|department/i);
  });

  it("updates assigned memberships (validated + de-duped)", async () => {
    const d = await makeDept(CLINIC_A);
    const m1 = await makeMembership(CLINIC_A);
    const created = await svc.createRoom(CLINIC_A, {
      departmentId: d._id,
      name: "X",
    });
    const updated = await svc.updateRoom(CLINIC_A, created._id, {
      assignedMembershipIds: [m1._id, m1._id],
    });
    expect(updated.assignedMembershipIds).toEqual([String(m1._id)]);
  });

  it("rejects a duplicate code on update (ConflictError)", async () => {
    const d = await makeDept(CLINIC_A);
    await svc.createRoom(CLINIC_A, {
      departmentId: d._id,
      name: "A",
      code: "TAKEN",
    });
    const other = await svc.createRoom(CLINIC_A, {
      departmentId: d._id,
      name: "B",
    });
    await expect(
      svc.updateRoom(CLINIC_A, other._id, { code: "TAKEN" }),
    ).rejects.toThrow(/code already exists/i);
  });
});

// ─── ARCHIVE ──────────────────────────────────────────────
describe("archiveRoom", () => {
  it("soft-archives (status=archived, record stays)", async () => {
    const d = await makeDept(CLINIC_A);
    const created = await svc.createRoom(CLINIC_A, {
      departmentId: d._id,
      name: "X",
    });
    const archived = await svc.archiveRoom(CLINIC_A, created._id);
    expect(archived.status).toBe("archived");

    const stillThere = await ClinicRoom.findById(created._id);
    expect(stillThere).not.toBeNull();
  });
});

// ─── CROSS-MODULE GUARD ───────────────────────────────────
describe("assertRoomInClinic", () => {
  it("returns null for a falsy roomId (optional)", async () => {
    await expect(svc.assertRoomInClinic(CLINIC_A, null)).resolves.toBeNull();
    await expect(
      svc.assertRoomInClinic(CLINIC_A, undefined),
    ).resolves.toBeNull();
    await expect(svc.assertRoomInClinic(CLINIC_A, "")).resolves.toBeNull();
  });

  it("resolves for a valid active room", async () => {
    const d = await makeDept(CLINIC_A);
    const room = await svc.createRoom(CLINIC_A, {
      departmentId: d._id,
      name: "X",
    });
    const id = await svc.assertRoomInClinic(CLINIC_A, room._id);
    expect(String(id)).toBe(String(room._id));
  });

  it("rejects a room from another clinic", async () => {
    const d = await makeDept(CLINIC_B);
    const room = await svc.createRoom(CLINIC_B, {
      departmentId: d._id,
      name: "Foreign",
    });
    await expect(svc.assertRoomInClinic(CLINIC_A, room._id)).rejects.toThrow(
      /does not belong to this clinic/i,
    );
  });

  it("rejects an archived room", async () => {
    const d = await makeDept(CLINIC_A);
    const room = await svc.createRoom(CLINIC_A, {
      departmentId: d._id,
      name: "X",
    });
    await svc.archiveRoom(CLINIC_A, room._id);
    await expect(svc.assertRoomInClinic(CLINIC_A, room._id)).rejects.toThrow(
      /archived/i,
    );
  });
});

// ─── MANDATORY TENANT ISOLATION ───────────────────────────
describe("tenant isolation (mandatory)", () => {
  it("clinic A cannot read clinic B's room", async () => {
    const dB = await makeDept(CLINIC_B);
    const roomB = await svc.createRoom(CLINIC_B, {
      departmentId: dB._id,
      name: "B-secret",
    });
    await expect(svc.getRoomById(CLINIC_A, roomB._id)).rejects.toThrow(
      /not found/i,
    );
  });

  it("clinic A cannot update clinic B's room", async () => {
    const dB = await makeDept(CLINIC_B);
    const roomB = await svc.createRoom(CLINIC_B, {
      departmentId: dB._id,
      name: "B",
    });
    await expect(
      svc.updateRoom(CLINIC_A, roomB._id, { name: "hacked" }),
    ).rejects.toThrow(/not found/i);

    const untouched = await ClinicRoom.findById(roomB._id);
    expect(untouched.name).toBe("B");
  });

  it("clinic A cannot archive clinic B's room", async () => {
    const dB = await makeDept(CLINIC_B);
    const roomB = await svc.createRoom(CLINIC_B, {
      departmentId: dB._id,
      name: "B",
    });
    await expect(svc.archiveRoom(CLINIC_A, roomB._id)).rejects.toThrow(
      /not found/i,
    );

    const untouched = await ClinicRoom.findById(roomB._id);
    expect(untouched.status).toBe("active");
  });
});
