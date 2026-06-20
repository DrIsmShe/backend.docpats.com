// server/modules/clinic/clinic-equipment/controllers/equipment.controller.js
//
// HTTP controllers for ClinicEquipment. Thin layer:
//   - reads clinicId from ALS via getCurrentClinicId() (NEVER from body)
//   - validates body/query with Zod (safeParse → 400 + details.issues)
//   - delegates to the service
//   - passes the acting user id through as actorId for audit fields
//
// Auth / RBAC middleware is applied upstream where the router is mounted
// (same as clinic-departments / clinic-rooms). No requirePerm here.

import { asyncHandler } from "../../../../common/middlewares/errorHandler.js";
import { ValidationError } from "../../../../common/utils/errors.js";
import {
  getCurrentClinicId,
  getCurrentUserId,
} from "../../../../common/context/tenantContext.js";
import {
  createEquipment,
  listEquipment,
  getEquipmentById,
  updateEquipment,
  archiveEquipment,
} from "../services/equipment.service.js";
import {
  createEquipmentSchema,
  updateEquipmentSchema,
  listEquipmentQuerySchema,
} from "../validators/equipment.schemas.js";

/** Turn a Zod error into our ValidationError with details.issues. */
function throwZod(parsed) {
  throw new ValidationError("Validation failed", {
    issues: parsed.error.issues.map((i) => ({
      path: i.path,
      message: i.message,
    })),
  });
}

export const createEquipmentController = asyncHandler(async (req, res) => {
  const clinicId = getCurrentClinicId();
  const parsed = createEquipmentSchema.safeParse(req.body);
  if (!parsed.success) throwZod(parsed);

  const equipment = await createEquipment(clinicId, {
    ...parsed.data,
    actorId: getCurrentUserId(),
  });
  res.status(201).json({ equipment });
});

export const listEquipmentController = asyncHandler(async (req, res) => {
  const clinicId = getCurrentClinicId();
  const parsed = listEquipmentQuerySchema.safeParse(req.query);
  if (!parsed.success) throwZod(parsed);

  const items = await listEquipment(clinicId, parsed.data);
  res.json({ items, count: items.length });
});

export const getEquipmentController = asyncHandler(async (req, res) => {
  const clinicId = getCurrentClinicId();
  const equipment = await getEquipmentById(clinicId, req.params.id);
  res.json({ equipment });
});

export const updateEquipmentController = asyncHandler(async (req, res) => {
  const clinicId = getCurrentClinicId();
  const parsed = updateEquipmentSchema.safeParse(req.body);
  if (!parsed.success) throwZod(parsed);

  const equipment = await updateEquipment(clinicId, req.params.id, {
    ...parsed.data,
    actorId: getCurrentUserId(),
  });
  res.json({ equipment });
});

export const archiveEquipmentController = asyncHandler(async (req, res) => {
  const clinicId = getCurrentClinicId();
  const equipment = await archiveEquipment(clinicId, req.params.id);
  res.json({ equipment });
});
