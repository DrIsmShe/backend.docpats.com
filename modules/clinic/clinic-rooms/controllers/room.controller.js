// server/modules/clinic/clinic-rooms/controllers/room.controller.js
//
// HTTP controllers for ClinicRoom. Thin layer:
//   - reads clinicId from ALS via getCurrentClinicId() (NEVER from body)
//   - validates the body/query with Zod (safeParse → 400 + details.issues)
//   - delegates to the service
//   - passes the acting user id through as actorId for audit fields
//
// Auth / RBAC middleware is applied upstream where the router is mounted
// (same as clinic-departments). No audit middleware here — rooms hold no
// PHI, matching the departments module's deliberate choice.

import { asyncHandler } from "../../../../common/middlewares/errorHandler.js";
import { ValidationError } from "../../../../common/utils/errors.js";
import {
  getCurrentClinicId,
  getCurrentUserId,
} from "../../../../common/context/tenantContext.js";
import {
  createRoom,
  listRooms,
  getRoomById,
  updateRoom,
  archiveRoom,
} from "../services/room.service.js";
import {
  createRoomSchema,
  updateRoomSchema,
  listRoomsQuerySchema,
} from "../validators/room.schemas.js";

/** Turn a Zod error into our ValidationError with details.issues. */
function throwZod(parsed) {
  throw new ValidationError("Validation failed", {
    issues: parsed.error.issues.map((i) => ({
      path: i.path,
      message: i.message,
    })),
  });
}

export const createRoomController = asyncHandler(async (req, res) => {
  const clinicId = getCurrentClinicId();
  const parsed = createRoomSchema.safeParse(req.body);
  if (!parsed.success) throwZod(parsed);

  const room = await createRoom(clinicId, {
    ...parsed.data,
    actorId: getCurrentUserId(),
  });
  res.status(201).json({ room });
});

export const listRoomsController = asyncHandler(async (req, res) => {
  const clinicId = getCurrentClinicId();
  const parsed = listRoomsQuerySchema.safeParse(req.query);
  if (!parsed.success) throwZod(parsed);

  const items = await listRooms(clinicId, parsed.data);
  res.json({ items, count: items.length });
});

export const getRoomController = asyncHandler(async (req, res) => {
  const clinicId = getCurrentClinicId();
  const room = await getRoomById(clinicId, req.params.id);
  res.json({ room });
});

export const updateRoomController = asyncHandler(async (req, res) => {
  const clinicId = getCurrentClinicId();
  const parsed = updateRoomSchema.safeParse(req.body);
  if (!parsed.success) throwZod(parsed);

  const room = await updateRoom(clinicId, req.params.id, {
    ...parsed.data,
    actorId: getCurrentUserId(),
  });
  res.json({ room });
});

export const archiveRoomController = asyncHandler(async (req, res) => {
  const clinicId = getCurrentClinicId();
  const room = await archiveRoom(clinicId, req.params.id);
  res.json({ room });
});
