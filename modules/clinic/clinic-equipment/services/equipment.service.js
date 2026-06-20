// server/modules/clinic/clinic-equipment/services/equipment.service.js
//
// Business logic for ClinicEquipment CRUD.
//
// Conventions (mirrors room.service.js):
//   - clinicId is ALWAYS an explicit argument (no ALS in the service layer),
//     so every query is tenant-scoped and the service is unit-testable.
//   - NO requirePerm here. RBAC lives upstream (tenantMiddleware + frontend
//     button-hiding), exactly like clinic-departments / clinic-rooms.
//   - Cross-module integrity is validated against the database:
//       * departmentId must be an ACTIVE department of the clinic
//       * roomId (if given) must be an ACTIVE room of the clinic AND belong
//         to the same department
//       * assignedMembershipIds must all belong to the clinic

import mongoose from "mongoose";
import ClinicEquipment from "../models/clinicEquipment.model.js";
import { assertDepartmentInClinic } from "../../clinic-departments/services/department.service.js";
import {
  assertRoomInClinic,
  getRoomById,
} from "../../clinic-rooms/services/room.service.js";
import {
  ValidationError,
  NotFoundError,
  ConflictError,
} from "../../../../common/utils/errors.js";
import logger from "../../../../common/logger.js";

// ─── helpers ──────────────────────────────────────────────────────────

// Validate assignedMembershipIds: every id must belong to this clinic.
// Returns a de-duplicated array of ObjectIds. Empty input → [].
async function validateMemberships(clinicId, ids) {
  if (!Array.isArray(ids) || ids.length === 0) return [];

  // De-dup as strings first.
  const unique = [...new Set(ids.map((id) => String(id)))];

  const { default: ClinicMembership } =
    await import("../../clinic-staff/models/clinicMembership.model.js");

  const found = await ClinicMembership.find({
    _id: { $in: unique },
    clinicId,
  })
    .select("_id")
    .lean();

  if (found.length !== unique.length) {
    throw new ValidationError(
      "Some assigned members do not belong to this clinic",
    );
  }

  return unique.map((id) => new mongoose.Types.ObjectId(id));
}

// Resolve + validate departmentId (required) and roomId (optional).
// Ensures the room, if given, belongs to the same department.
async function resolvePlacement(clinicId, departmentId, roomId) {
  const deptId = await assertDepartmentInClinic(clinicId, departmentId);
  if (!deptId) {
    throw new ValidationError("departmentId is required");
  }

  let resolvedRoomId = null;
  if (roomId) {
    resolvedRoomId = await assertRoomInClinic(clinicId, roomId);
    // Room must be in the same department as the equipment.
    const room = await getRoomById(clinicId, resolvedRoomId);
    if (String(room.departmentId) !== String(deptId)) {
      throw new ValidationError(
        "roomId must belong to the same department as the equipment",
      );
    }
  }

  return { deptId, resolvedRoomId };
}

function toConflictIfDupCode(err) {
  if (err && err.code === 11000) {
    return new ConflictError("inventoryNumber already exists in this clinic");
  }
  return err;
}

// ─── createEquipment ───────────────────────────────────────────────────
export async function createEquipment(clinicId, input) {
  if (!clinicId) throw new ValidationError("clinicId is required");

  const { deptId, resolvedRoomId } = await resolvePlacement(
    clinicId,
    input.departmentId,
    input.roomId,
  );

  const assignedMembershipIds = await validateMemberships(
    clinicId,
    input.assignedMembershipIds,
  );

  try {
    const doc = await ClinicEquipment.create({
      clinicId,
      departmentId: deptId,
      roomId: resolvedRoomId,
      name: input.name,
      inventoryNumber: input.inventoryNumber ?? null,
      category: input.category ?? "other",
      manufacturer: input.manufacturer ?? null,
      model: input.model ?? null,
      serialNumber: input.serialNumber ?? null,
      status: input.status ?? "operational",
      purchaseDate: input.purchaseDate ?? null,
      warrantyUntil: input.warrantyUntil ?? null,
      lastServiceDate: input.lastServiceDate ?? null,
      nextServiceDate: input.nextServiceDate ?? null,
      assignedMembershipIds,
      notes: input.notes ?? null,
      createdBy: input.actorId ?? null,
    });
    return doc.toObject();
  } catch (err) {
    throw toConflictIfDupCode(err);
  }
}

// ─── listEquipment ───────────────────────────────────────────────────
export async function listEquipment(clinicId, filters = {}) {
  if (!clinicId) throw new ValidationError("clinicId is required");

  const query = { clinicId };
  if (filters.departmentId) query.departmentId = filters.departmentId;
  if (filters.roomId) query.roomId = filters.roomId;
  if (filters.category) query.category = filters.category;
  if (filters.status) query.status = filters.status;

  if (filters.q && filters.q.trim()) {
    // Escape regex metacharacters so user input is treated literally.
    const safe = filters.q.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const rx = new RegExp(safe, "i");
    query.$or = [{ name: rx }, { inventoryNumber: rx }, { serialNumber: rx }];
  }

  return ClinicEquipment.find(query).sort({ name: 1 }).lean();
}

// ─── getEquipmentById ───────────────────────────────────────────────────
export async function getEquipmentById(clinicId, id) {
  if (!clinicId) throw new ValidationError("clinicId is required");

  const doc = await ClinicEquipment.findOne({ _id: id, clinicId }).lean();
  if (!doc) throw new NotFoundError("Equipment not found");
  return doc;
}

// ─── updateEquipment ───────────────────────────────────────────────────
export async function updateEquipment(clinicId, id, input) {
  if (!clinicId) throw new ValidationError("clinicId is required");

  const existing = await ClinicEquipment.findOne({ _id: id, clinicId });
  if (!existing) throw new NotFoundError("Equipment not found");

  const update = {};

  // Placement: department and/or room may move. Re-validate the resulting
  // pair so a room always matches its department.
  const nextDeptId = input.departmentId ?? existing.departmentId;
  const roomProvided = Object.prototype.hasOwnProperty.call(input, "roomId");
  const nextRoomId = roomProvided ? input.roomId : existing.roomId;

  if (input.departmentId !== undefined || roomProvided) {
    const { deptId, resolvedRoomId } = await resolvePlacement(
      clinicId,
      nextDeptId,
      nextRoomId,
    );
    update.departmentId = deptId;
    update.roomId = resolvedRoomId;
  }

  if (input.name !== undefined) update.name = input.name;
  if (input.inventoryNumber !== undefined)
    update.inventoryNumber = input.inventoryNumber ?? null;
  if (input.category !== undefined) update.category = input.category;
  if (input.manufacturer !== undefined)
    update.manufacturer = input.manufacturer ?? null;
  if (input.model !== undefined) update.model = input.model ?? null;
  if (input.serialNumber !== undefined)
    update.serialNumber = input.serialNumber ?? null;
  if (input.status !== undefined) update.status = input.status;
  if (input.purchaseDate !== undefined)
    update.purchaseDate = input.purchaseDate ?? null;
  if (input.warrantyUntil !== undefined)
    update.warrantyUntil = input.warrantyUntil ?? null;
  if (input.lastServiceDate !== undefined)
    update.lastServiceDate = input.lastServiceDate ?? null;
  if (input.nextServiceDate !== undefined)
    update.nextServiceDate = input.nextServiceDate ?? null;
  if (input.notes !== undefined) update.notes = input.notes ?? null;
  if (input.actorId !== undefined) update.updatedBy = input.actorId;

  if (input.assignedMembershipIds !== undefined) {
    update.assignedMembershipIds = await validateMemberships(
      clinicId,
      input.assignedMembershipIds,
    );
  }

  try {
    const doc = await ClinicEquipment.findOneAndUpdate(
      { _id: id, clinicId },
      { $set: update },
      { new: true, runValidators: true },
    ).lean();
    if (!doc) throw new NotFoundError("Equipment not found");
    return doc;
  } catch (err) {
    throw toConflictIfDupCode(err);
  }
}

// ─── archiveEquipment (soft delete → status: archived) ─────────────────
export async function archiveEquipment(clinicId, id) {
  if (!clinicId) throw new ValidationError("clinicId is required");

  const doc = await ClinicEquipment.findOneAndUpdate(
    { _id: id, clinicId },
    { $set: { status: "archived" } },
    { new: true },
  ).lean();
  if (!doc) throw new NotFoundError("Equipment not found");

  logger?.info?.(
    { clinicId: String(clinicId), equipmentId: String(id) },
    "equipment archived",
  );
  return doc;
}

// ─── assertEquipmentInClinic (cross-module guard) ──────────────────────
// Returns the equipment _id when it exists, is in this clinic, and is not
// archived. Returns null for a falsy id (optional reference). Throws
// otherwise. Mirrors assertRoomInClinic.
export async function assertEquipmentInClinic(clinicId, equipmentId) {
  if (!equipmentId) return null;

  const doc = await ClinicEquipment.findOne({
    _id: equipmentId,
    clinicId,
  })
    .select("_id status")
    .lean();

  if (!doc) {
    throw new ValidationError("Equipment does not belong to this clinic");
  }
  if (doc.status === "archived") {
    throw new ValidationError("Equipment is archived");
  }
  return doc._id;
}
