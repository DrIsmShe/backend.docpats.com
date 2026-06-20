// server/modules/clinic/clinic-rooms/services/room.service.js
//
// Business logic for ClinicRoom CRUD.
//
// Architecture (mirrors department.service.js):
//   1. Tenant isolation: every function takes the clinicId explicitly
//      (resolved by the controller from getCurrentClinicId()) and passes
//      it to queries. The tenantScoped plugin also auto-filters, so this
//      is belt-and-suspenders — find/findOne can never cross clinics.
//   2. departmentId is validated against the clinic's ACTIVE departments
//      via assertDepartmentInClinic (imported from the departments
//      service — patients already import it, no new cycle). A room MUST
//      have a department, so on create we reject a null/missing one with
//      ValidationError; assertDepartmentInClinic itself rejects
//      foreign/archived/non-existent department ids.
//   3. assignedMembershipIds are validated against ClinicMembership of
//      THIS clinic. Unknown / cross-clinic ids → ValidationError. The
//      array is de-duplicated before save.
//   4. code uniqueness is enforced by a partial unique index; we catch
//      the duplicate-key error (11000) and rethrow as ConflictError so
//      the controller can map it to 409.
//   5. archiveRoom is a soft status flip (status -> "archived"), not a
//      delete. Rooms are referenced by future schedules, so we keep them.
//   6. assertRoomInClinic(clinicId, roomId) is the cross-module guard
//      other modules (scheduler, appointments) will call to validate a
//      roomId belongs to this clinic and is usable. Returns the room
//      _id (ObjectId) or null when roomId is null/undefined; throws
//      ValidationError for foreign / archived / missing rooms.
//
// All functions throw typed errors from common/utils/errors.js; the
// controller (asyncHandler) turns them into HTTP responses.

import mongoose from "mongoose";
import ClinicRoom from "../models/clinicRoom.model.js";
import {
  ValidationError,
  NotFoundError,
  ConflictError,
} from "../../../../common/utils/errors.js";
import { assertDepartmentInClinic } from "../../clinic-departments/services/department.service.js";
import logger from "../../../../common/logger.js";

const log = logger.child({ module: "clinic-rooms/service" });

// ─── helpers ──────────────────────────────────────────────────────────

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Validate that every membershipId in the list belongs to THIS clinic.
 * Returns a de-duplicated array of ObjectIds. Empty/missing input → [].
 * Throws ValidationError if any id is unknown or from another clinic.
 *
 * ClinicMembership is imported lazily to avoid any import-order coupling
 * with the staff module.
 */
async function validateMemberships(clinicId, membershipIds) {
  if (!membershipIds || membershipIds.length === 0) return [];

  // De-dupe incoming ids (string form) preserving first-seen order.
  const seen = new Set();
  const unique = [];
  for (const raw of membershipIds) {
    const s = String(raw);
    if (seen.has(s)) continue;
    seen.add(s);
    unique.push(s);
  }

  const ClinicMembership = (
    await import("../../clinic-staff/models/clinicMembership.model.js")
  ).default;

  // Find which of the requested memberships actually exist in this clinic.
  const found = await ClinicMembership.find({
    _id: { $in: unique },
    clinicId,
  })
    .select("_id")
    .lean();

  const foundSet = new Set(found.map((m) => String(m._id)));
  const missing = unique.filter((id) => !foundSet.has(id));
  if (missing.length > 0) {
    throw new ValidationError(
      "Some assigned members do not belong to this clinic",
      { field: "assignedMembershipIds", invalidIds: missing },
    );
  }

  return unique.map((id) => new mongoose.Types.ObjectId(id));
}

/** Shape a lean/doc room for API responses. */
function toApiShape(doc) {
  if (!doc) return null;
  return {
    _id: String(doc._id),
    clinicId: String(doc.clinicId),
    departmentId: doc.departmentId ? String(doc.departmentId) : null,
    name: doc.name,
    code: doc.code || null,
    floor: doc.floor || null,
    capacity: typeof doc.capacity === "number" ? doc.capacity : null,
    notes: doc.notes || null,
    assignedMembershipIds: Array.isArray(doc.assignedMembershipIds)
      ? doc.assignedMembershipIds.map((m) => String(m))
      : [],
    status: doc.status,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

// ─── createRoom ───────────────────────────────────────────────────────

export async function createRoom(clinicId, input) {
  if (!clinicId) throw new ValidationError("clinicId is required");

  // A room must belong to a department. assertDepartmentInClinic returns
  // the dept _id, or null when departmentId is null/undefined — for rooms
  // null is not acceptable, so we reject it explicitly.
  const departmentId = await assertDepartmentInClinic(
    clinicId,
    input.departmentId,
  );
  if (!departmentId) {
    throw new ValidationError("A room must belong to a department", {
      field: "departmentId",
    });
  }

  const assigned = await validateMemberships(
    clinicId,
    input.assignedMembershipIds,
  );

  try {
    const doc = await ClinicRoom.create({
      clinicId,
      departmentId,
      name: input.name,
      code: input.code ?? null,
      floor: input.floor ?? null,
      capacity: input.capacity ?? null,
      notes: input.notes ?? null,
      assignedMembershipIds: assigned,
      status: input.status || "active",
      createdBy: input.actorId || null,
    });

    log.info(
      {
        roomId: String(doc._id),
        clinicId: String(clinicId),
        departmentId: String(departmentId),
      },
      "Room created",
    );

    return toApiShape(doc.toObject());
  } catch (err) {
    if (err?.code === 11000) {
      throw new ConflictError("A room with this code already exists", {
        field: "code",
      });
    }
    throw err;
  }
}

// ─── listRooms ────────────────────────────────────────────────────────

export async function listRooms(clinicId, query = {}) {
  if (!clinicId) throw new ValidationError("clinicId is required");

  const filter = { clinicId };
  if (query.departmentId) filter.departmentId = query.departmentId;
  if (query.status) filter.status = query.status;

  const items = await ClinicRoom.find(filter)
    .sort({ status: 1, name: 1 })
    .lean();

  return items.map(toApiShape);
}

// ─── getRoomById ──────────────────────────────────────────────────────

export async function getRoomById(clinicId, roomId) {
  if (!clinicId) throw new ValidationError("clinicId is required");

  const doc = await ClinicRoom.findOne({ _id: roomId, clinicId }).lean();
  if (!doc) throw new NotFoundError("Room");
  return toApiShape(doc);
}

// ─── updateRoom ───────────────────────────────────────────────────────

export async function updateRoom(clinicId, roomId, input) {
  if (!clinicId) throw new ValidationError("clinicId is required");

  const existing = await ClinicRoom.findOne({ _id: roomId, clinicId });
  if (!existing) throw new NotFoundError("Room");

  const update = { lastUpdatedBy: input.actorId || null };

  if (Object.prototype.hasOwnProperty.call(input, "departmentId")) {
    // departmentId on update is optional but, if present, must be valid.
    // (The Zod schema forbids null here, so we won't orphan a room.)
    const departmentId = await assertDepartmentInClinic(
      clinicId,
      input.departmentId,
    );
    if (!departmentId) {
      throw new ValidationError("A room must belong to a department", {
        field: "departmentId",
      });
    }
    update.departmentId = departmentId;
  }

  if (Object.prototype.hasOwnProperty.call(input, "name")) {
    update.name = input.name;
  }
  if (Object.prototype.hasOwnProperty.call(input, "code")) {
    update.code = input.code ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(input, "floor")) {
    update.floor = input.floor ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(input, "capacity")) {
    update.capacity = input.capacity ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(input, "notes")) {
    update.notes = input.notes ?? null;
  }
  if (Object.prototype.hasOwnProperty.call(input, "assignedMembershipIds")) {
    update.assignedMembershipIds = await validateMemberships(
      clinicId,
      input.assignedMembershipIds,
    );
  }
  if (Object.prototype.hasOwnProperty.call(input, "status")) {
    update.status = input.status;
  }

  try {
    const updated = await ClinicRoom.findOneAndUpdate(
      { _id: roomId, clinicId },
      update,
      { new: true, runValidators: true },
    ).lean();
    if (!updated) throw new NotFoundError("Room");

    log.info(
      { roomId: String(roomId), clinicId: String(clinicId) },
      "Room updated",
    );

    return toApiShape(updated);
  } catch (err) {
    if (err?.code === 11000) {
      throw new ConflictError("A room with this code already exists", {
        field: "code",
      });
    }
    throw err;
  }
}

// ─── archiveRoom (soft) ───────────────────────────────────────────────

export async function archiveRoom(clinicId, roomId) {
  if (!clinicId) throw new ValidationError("clinicId is required");

  const updated = await ClinicRoom.findOneAndUpdate(
    { _id: roomId, clinicId },
    { status: "archived" },
    { new: true },
  ).lean();
  if (!updated) throw new NotFoundError("Room");

  log.info(
    { roomId: String(roomId), clinicId: String(clinicId) },
    "Room archived",
  );

  return toApiShape(updated);
}

// ─── cross-module guard ───────────────────────────────────────────────
//
// Used by the scheduler / appointments modules to validate a roomId
// before attaching it to a record. Same contract as
// assertDepartmentInClinic:
//   - null / undefined roomId        → returns null (room is optional there)
//   - valid active room in clinic     → returns the room's _id (ObjectId)
//   - foreign / archived / missing    → throws ValidationError

export async function assertRoomInClinic(clinicId, roomId) {
  if (roomId === null || roomId === undefined || roomId === "") return null;

  const doc = await ClinicRoom.findOne({ _id: roomId, clinicId })
    .select("_id status")
    .lean();

  if (!doc) {
    throw new ValidationError("Room does not belong to this clinic", {
      field: "roomId",
    });
  }
  if (doc.status === "archived") {
    throw new ValidationError("Room is archived", { field: "roomId" });
  }
  return doc._id;
}
