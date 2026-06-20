// server/__tests__/clinic-equipment/equipment.service.test.js
//
// Service-level tests: CRUD, inventoryNumber conflicts, departmentId +
// roomId validation (incl. room↔department consistency),
// assignedMembershipIds validation, soft-archive, the cross-module
// assertEquipmentInClinic guard, and the MANDATORY tenant-isolation suite.
//
// Mongo connection + per-test cleanup come from __tests__/setup.js.
// The equipment service takes clinicId as an explicit argument (no ALS),
// like room/department services — so no tenantContext mock.
//
// Real ClinicDepartment, ClinicRoom and ClinicMembership documents are
// created as fixtures because the service validates against them in the DB.

import { describe, it, expect, beforeAll } from "vitest";
import mongoose from "mongoose";

import ClinicEquipment from "../../modules/clinic/clinic-equipment/models/clinicEquipment.model.js";
import * as svc from "../../modules/clinic/clinic-equipment/services/equipment.service.js";
import * as deptSvc from "../../modules/clinic/clinic-departments/services/department.service.js";
import * as roomSvc from "../../modules/clinic/clinic-rooms/services/room.service.js";
import ClinicMembership from "../../modules/clinic/clinic-staff/models/clinicMembership.model.js";

const CLINIC_A = new mongoose.Types.ObjectId();
const CLINIC_B = new mongoose.Types.ObjectId();

beforeAll(async () => {
  await ClinicEquipment.syncIndexes();
});

// ─── fixtures ─────────────────────────────────────────────
async function makeDept(clinicId, name = "Неврология") {
  return deptSvc.createDepartment(clinicId, { name });
}

async function makeRoom(clinicId, departmentId, name = "Кабинет") {
  return roomSvc.createRoom(clinicId, { departmentId, name });
}

async function makeMembership(clinicId, role = "doctor") {
  return ClinicMembership.create({
    userId: new mongoose.Types.ObjectId(),
    clinicId,
    role,
  });
}

// ─── CREATE ───────────────────────────────────────────────
describe("createEquipment — basics", () => {
  it("creates with defaults and links to the department", async () => {
    const dept = await makeDept(CLINIC_A);
    const eq = await svc.createEquipment(CLINIC_A, {
      departmentId: dept._id,
      name: "Аппарат УЗИ",
    });
    expect(eq.name).toBe("Аппарат УЗИ");
    expect(eq.status).toBe("operational");
    expect(eq.category).toBe("other");
    expect(eq.roomId).toBeNull();
    expect(String(eq.clinicId)).toBe(String(CLINIC_A));
    expect(String(eq.departmentId)).toBe(String(dept._id));
  });

  it("accepts optional fields incl. room in the same department", async () => {
    const dept = await makeDept(CLINIC_A);
    const room = await makeRoom(CLINIC_A, dept._id, "Каб. 12");
    const eq = await svc.createEquipment(CLINIC_A, {
      departmentId: dept._id,
      roomId: room._id,
      name: "КТ-сканер",
      inventoryNumber: "CT-1",
      category: "imaging",
      manufacturer: "Siemens",
      model: "Somatom",
      serialNumber: "SN-777",
      status: "operational",
      notes: "В углу",
    });
    expect(String(eq.roomId)).toBe(String(room._id));
    expect(eq.inventoryNumber).toBe("CT-1");
    expect(eq.category).toBe("imaging");
    expect(eq.manufacturer).toBe("Siemens");
  });

  it("assigns valid memberships and de-duplicates them", async () => {
    const dept = await makeDept(CLINIC_A);
    const m1 = await makeMembership(CLINIC_A);
    const m2 = await makeMembership(CLINIC_A);
    const eq = await svc.createEquipment(CLINIC_A, {
      departmentId: dept._id,
      name: "Shared device",
      assignedMembershipIds: [m1._id, m2._id, m1._id],
    });
    expect(eq.assignedMembershipIds).toHaveLength(2);
    expect(eq.assignedMembershipIds.map(String).sort()).toEqual(
      [String(m1._id), String(m2._id)].sort(),
    );
  });
});

describe("createEquipment — errors", () => {
  it("rejects a departmentId from another clinic", async () => {
    const foreignDept = await makeDept(CLINIC_B, "Foreign");
    await expect(
      svc.createEquipment(CLINIC_A, {
        departmentId: foreignDept._id,
        name: "X",
      }),
    ).rejects.toThrow(/not found in this clinic|department/i);
  });

  it("rejects an archived department", async () => {
    const dept = await makeDept(CLINIC_A);
    await deptSvc.archiveDepartment(CLINIC_A, dept._id);
    await expect(
      svc.createEquipment(CLINIC_A, { departmentId: dept._id, name: "X" }),
    ).rejects.toThrow(/archived|not found/i);
  });

  it("rejects a room from another department", async () => {
    const d1 = await makeDept(CLINIC_A, "D1");
    const d2 = await makeDept(CLINIC_A, "D2");
    const roomInD2 = await makeRoom(CLINIC_A, d2._id, "R-d2");
    await expect(
      svc.createEquipment(CLINIC_A, {
        departmentId: d1._id,
        roomId: roomInD2._id,
        name: "X",
      }),
    ).rejects.toThrow(/same department/i);
  });

  it("rejects a room from another clinic", async () => {
    const deptA = await makeDept(CLINIC_A);
    const deptB = await makeDept(CLINIC_B);
    const foreignRoom = await makeRoom(CLINIC_B, deptB._id, "Foreign room");
    await expect(
      svc.createEquipment(CLINIC_A, {
        departmentId: deptA._id,
        roomId: foreignRoom._id,
        name: "X",
      }),
    ).rejects.toThrow(/does not belong to this clinic|same department/i);
  });

  it("rejects a duplicate inventoryNumber in the same clinic (ConflictError)", async () => {
    const dept = await makeDept(CLINIC_A);
    await svc.createEquipment(CLINIC_A, {
      departmentId: dept._id,
      name: "A",
      inventoryNumber: "DUP-1",
    });
    await expect(
      svc.createEquipment(CLINIC_A, {
        departmentId: dept._id,
        name: "B",
        inventoryNumber: "DUP-1",
      }),
    ).rejects.toThrow(/inventoryNumber already exists/i);
  });

  it("rejects an assigned membership from another clinic", async () => {
    const dept = await makeDept(CLINIC_A);
    const foreignMember = await makeMembership(CLINIC_B);
    await expect(
      svc.createEquipment(CLINIC_A, {
        departmentId: dept._id,
        name: "X",
        assignedMembershipIds: [foreignMember._id],
      }),
    ).rejects.toThrow(/do not belong to this clinic/i);
  });
});

// ─── LIST ─────────────────────────────────────────────────
describe("listEquipment", () => {
  it("returns only this clinic's equipment", async () => {
    const dA = await makeDept(CLINIC_A);
    const dB = await makeDept(CLINIC_B);
    await svc.createEquipment(CLINIC_A, { departmentId: dA._id, name: "A1" });
    await svc.createEquipment(CLINIC_A, { departmentId: dA._id, name: "A2" });
    await svc.createEquipment(CLINIC_B, { departmentId: dB._id, name: "B1" });

    const list = await svc.listEquipment(CLINIC_A);
    expect(list).toHaveLength(2);
    expect(list.map((e) => e.name).sort()).toEqual(["A1", "A2"]);
  });

  it("filters by departmentId", async () => {
    const d1 = await makeDept(CLINIC_A, "Dept1");
    const d2 = await makeDept(CLINIC_A, "Dept2");
    await svc.createEquipment(CLINIC_A, { departmentId: d1._id, name: "In1" });
    await svc.createEquipment(CLINIC_A, { departmentId: d2._id, name: "In2" });

    const only1 = await svc.listEquipment(CLINIC_A, { departmentId: d1._id });
    expect(only1.map((e) => e.name)).toEqual(["In1"]);
  });

  it("filters by category and status", async () => {
    const d = await makeDept(CLINIC_A);
    await svc.createEquipment(CLINIC_A, {
      departmentId: d._id,
      name: "Imager",
      category: "imaging",
    });
    await svc.createEquipment(CLINIC_A, {
      departmentId: d._id,
      name: "Broken thing",
      status: "broken",
    });

    const imaging = await svc.listEquipment(CLINIC_A, { category: "imaging" });
    expect(imaging.map((e) => e.name)).toEqual(["Imager"]);

    const broken = await svc.listEquipment(CLINIC_A, { status: "broken" });
    expect(broken.map((e) => e.name)).toEqual(["Broken thing"]);
  });

  it("search q matches name and treats input as literal (regex-safe)", async () => {
    const d = await makeDept(CLINIC_A);
    await svc.createEquipment(CLINIC_A, {
      departmentId: d._id,
      name: "Кардиомонитор",
    });
    await svc.createEquipment(CLINIC_A, {
      departmentId: d._id,
      name: "Дефибриллятор",
    });

    const hit = await svc.listEquipment(CLINIC_A, { q: "Кардио" });
    expect(hit).toHaveLength(1);

    const none = await svc.listEquipment(CLINIC_A, { q: ".*" });
    expect(none).toHaveLength(0);
  });
});

// ─── GET ──────────────────────────────────────────────────
describe("getEquipmentById", () => {
  it("returns the equipment", async () => {
    const d = await makeDept(CLINIC_A);
    const created = await svc.createEquipment(CLINIC_A, {
      departmentId: d._id,
      name: "X",
    });
    const found = await svc.getEquipmentById(CLINIC_A, created._id);
    expect(found.name).toBe("X");
  });

  it("throws NotFound for an id outside the clinic", async () => {
    const d = await makeDept(CLINIC_A);
    const created = await svc.createEquipment(CLINIC_A, {
      departmentId: d._id,
      name: "X",
    });
    await expect(svc.getEquipmentById(CLINIC_B, created._id)).rejects.toThrow(
      /not found/i,
    );
  });
});

// ─── UPDATE ───────────────────────────────────────────────
describe("updateEquipment", () => {
  it("updates simple fields", async () => {
    const d = await makeDept(CLINIC_A);
    const created = await svc.createEquipment(CLINIC_A, {
      departmentId: d._id,
      name: "Old",
    });
    const updated = await svc.updateEquipment(CLINIC_A, created._id, {
      name: "New",
      status: "maintenance",
      manufacturer: "GE",
    });
    expect(updated.name).toBe("New");
    expect(updated.status).toBe("maintenance");
    expect(updated.manufacturer).toBe("GE");
  });

  it("moves equipment to another department (clears stale room check)", async () => {
    const d1 = await makeDept(CLINIC_A, "D1");
    const d2 = await makeDept(CLINIC_A, "D2");
    const created = await svc.createEquipment(CLINIC_A, {
      departmentId: d1._id,
      name: "X",
    });
    const moved = await svc.updateEquipment(CLINIC_A, created._id, {
      departmentId: d2._id,
    });
    expect(String(moved.departmentId)).toBe(String(d2._id));
  });

  it("attaches a room in the same department", async () => {
    const d = await makeDept(CLINIC_A);
    const room = await makeRoom(CLINIC_A, d._id, "R1");
    const created = await svc.createEquipment(CLINIC_A, {
      departmentId: d._id,
      name: "X",
    });
    const updated = await svc.updateEquipment(CLINIC_A, created._id, {
      roomId: room._id,
    });
    expect(String(updated.roomId)).toBe(String(room._id));
  });

  it("rejects attaching a room from a different department", async () => {
    const d1 = await makeDept(CLINIC_A, "D1");
    const d2 = await makeDept(CLINIC_A, "D2");
    const roomInD2 = await makeRoom(CLINIC_A, d2._id, "R-d2");
    const created = await svc.createEquipment(CLINIC_A, {
      departmentId: d1._id,
      name: "X",
    });
    await expect(
      svc.updateEquipment(CLINIC_A, created._id, { roomId: roomInD2._id }),
    ).rejects.toThrow(/same department/i);
  });

  it("detaches a room with roomId: null", async () => {
    const d = await makeDept(CLINIC_A);
    const room = await makeRoom(CLINIC_A, d._id, "R1");
    const created = await svc.createEquipment(CLINIC_A, {
      departmentId: d._id,
      roomId: room._id,
      name: "X",
    });
    const updated = await svc.updateEquipment(CLINIC_A, created._id, {
      roomId: null,
    });
    expect(updated.roomId).toBeNull();
  });

  it("rejects a duplicate inventoryNumber on update (ConflictError)", async () => {
    const d = await makeDept(CLINIC_A);
    await svc.createEquipment(CLINIC_A, {
      departmentId: d._id,
      name: "A",
      inventoryNumber: "TAKEN",
    });
    const other = await svc.createEquipment(CLINIC_A, {
      departmentId: d._id,
      name: "B",
    });
    await expect(
      svc.updateEquipment(CLINIC_A, other._id, { inventoryNumber: "TAKEN" }),
    ).rejects.toThrow(/inventoryNumber already exists/i);
  });
});

// ─── ARCHIVE ──────────────────────────────────────────────
describe("archiveEquipment", () => {
  it("soft-archives (status=archived, record stays)", async () => {
    const d = await makeDept(CLINIC_A);
    const created = await svc.createEquipment(CLINIC_A, {
      departmentId: d._id,
      name: "X",
    });
    const archived = await svc.archiveEquipment(CLINIC_A, created._id);
    expect(archived.status).toBe("archived");

    const stillThere = await ClinicEquipment.findById(created._id);
    expect(stillThere).not.toBeNull();
  });
});

// ─── CROSS-MODULE GUARD ───────────────────────────────────
describe("assertEquipmentInClinic", () => {
  it("returns null for a falsy id (optional)", async () => {
    await expect(
      svc.assertEquipmentInClinic(CLINIC_A, null),
    ).resolves.toBeNull();
    await expect(
      svc.assertEquipmentInClinic(CLINIC_A, undefined),
    ).resolves.toBeNull();
    await expect(svc.assertEquipmentInClinic(CLINIC_A, "")).resolves.toBeNull();
  });

  it("resolves for a valid non-archived equipment", async () => {
    const d = await makeDept(CLINIC_A);
    const eq = await svc.createEquipment(CLINIC_A, {
      departmentId: d._id,
      name: "X",
    });
    const id = await svc.assertEquipmentInClinic(CLINIC_A, eq._id);
    expect(String(id)).toBe(String(eq._id));
  });

  it("rejects equipment from another clinic", async () => {
    const d = await makeDept(CLINIC_B);
    const eq = await svc.createEquipment(CLINIC_B, {
      departmentId: d._id,
      name: "Foreign",
    });
    await expect(svc.assertEquipmentInClinic(CLINIC_A, eq._id)).rejects.toThrow(
      /does not belong to this clinic/i,
    );
  });

  it("rejects archived equipment", async () => {
    const d = await makeDept(CLINIC_A);
    const eq = await svc.createEquipment(CLINIC_A, {
      departmentId: d._id,
      name: "X",
    });
    await svc.archiveEquipment(CLINIC_A, eq._id);
    await expect(svc.assertEquipmentInClinic(CLINIC_A, eq._id)).rejects.toThrow(
      /archived/i,
    );
  });
});

// ─── MANDATORY TENANT ISOLATION ───────────────────────────
describe("tenant isolation (mandatory)", () => {
  it("clinic A cannot read clinic B's equipment", async () => {
    const dB = await makeDept(CLINIC_B);
    const eqB = await svc.createEquipment(CLINIC_B, {
      departmentId: dB._id,
      name: "B-secret",
    });
    await expect(svc.getEquipmentById(CLINIC_A, eqB._id)).rejects.toThrow(
      /not found/i,
    );
  });

  it("clinic A cannot update clinic B's equipment", async () => {
    const dB = await makeDept(CLINIC_B);
    const eqB = await svc.createEquipment(CLINIC_B, {
      departmentId: dB._id,
      name: "B",
    });
    await expect(
      svc.updateEquipment(CLINIC_A, eqB._id, { name: "hacked" }),
    ).rejects.toThrow(/not found/i);

    const untouched = await ClinicEquipment.findById(eqB._id);
    expect(untouched.name).toBe("B");
  });

  it("clinic A cannot archive clinic B's equipment", async () => {
    const dB = await makeDept(CLINIC_B);
    const eqB = await svc.createEquipment(CLINIC_B, {
      departmentId: dB._id,
      name: "B",
    });
    await expect(svc.archiveEquipment(CLINIC_A, eqB._id)).rejects.toThrow(
      /not found/i,
    );

    const untouched = await ClinicEquipment.findById(eqB._id);
    expect(untouched.status).toBe("operational");
  });
});
