// server/modules/clinic/clinic-telemed/controllers/telemed.controller.js
//
// HTTP controllers for TelemedSession. Thin layer, same shape as the other
// clinic-* controllers.

import { asyncHandler } from "../../../../common/middlewares/errorHandler.js";
import { ValidationError } from "../../../../common/utils/errors.js";
import {
  getCurrentClinicId,
  getCurrentUserId,
} from "../../../../common/context/tenantContext.js";
import {
  createSession,
  listSessions,
  getSessionById,
  updateSession,
  cancelSession,
} from "../services/telemed.service.js";
import {
  createSessionSchema,
  updateSessionSchema,
  listSessionsQuerySchema,
} from "../validators/telemed.schemas.js";

function throwZod(parsed) {
  throw new ValidationError("Validation failed", {
    issues: parsed.error.issues.map((i) => ({
      path: i.path,
      message: i.message,
    })),
  });
}

export const createSessionController = asyncHandler(async (req, res) => {
  const clinicId = getCurrentClinicId();
  const parsed = createSessionSchema.safeParse(req.body);
  if (!parsed.success) throwZod(parsed);

  const session = await createSession(clinicId, {
    ...parsed.data,
    actorId: getCurrentUserId(),
  });
  res.status(201).json({ session });
});

export const listSessionsController = asyncHandler(async (req, res) => {
  const clinicId = getCurrentClinicId();
  const parsed = listSessionsQuerySchema.safeParse(req.query);
  if (!parsed.success) throwZod(parsed);

  const items = await listSessions(clinicId, parsed.data);
  res.json({ items, count: items.length });
});

export const getSessionController = asyncHandler(async (req, res) => {
  const clinicId = getCurrentClinicId();
  const session = await getSessionById(clinicId, req.params.id);
  res.json({ session });
});

export const updateSessionController = asyncHandler(async (req, res) => {
  const clinicId = getCurrentClinicId();
  const parsed = updateSessionSchema.safeParse(req.body);
  if (!parsed.success) throwZod(parsed);

  const session = await updateSession(clinicId, req.params.id, {
    ...parsed.data,
    actorId: getCurrentUserId(),
  });
  res.json({ session });
});

export const cancelSessionController = asyncHandler(async (req, res) => {
  const clinicId = getCurrentClinicId();
  const session = await cancelSession(clinicId, req.params.id);
  res.json({ session });
});
