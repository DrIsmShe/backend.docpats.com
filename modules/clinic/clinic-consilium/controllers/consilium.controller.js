// server/modules/clinic/clinic-consilium/controllers/consilium.controller.js
//
// HTTP controllers for Consilium + messages. Thin layer, same shape as the
// other clinic-* controllers.
//
// Note: the acting user's membershipId is not available from the ALS context
// (which carries userId + clinicId), so initiator/author membership is left
// null for the MVP — authorship is tracked via createdBy (userId) and the
// frontend resolves the member by userId. A later pass can resolve the
// membership server-side.

import { asyncHandler } from "../../../../common/middlewares/errorHandler.js";
import { ValidationError } from "../../../../common/utils/errors.js";
import {
  getCurrentClinicId,
  getCurrentUserId,
} from "../../../../common/context/tenantContext.js";
import {
  createConsilium,
  listConsilia,
  getConsiliumById,
  updateConsilium,
  archiveConsilium,
  addMessage,
  listMessages,
} from "../services/consilium.service.js";
import {
  createConsiliumSchema,
  updateConsiliumSchema,
  listConsiliaQuerySchema,
  createMessageSchema,
} from "../validators/consilium.schemas.js";

function throwZod(parsed) {
  throw new ValidationError("Validation failed", {
    issues: parsed.error.issues.map((i) => ({
      path: i.path,
      message: i.message,
    })),
  });
}

// ─── Consilium ───
export const createConsiliumController = asyncHandler(async (req, res) => {
  const clinicId = getCurrentClinicId();
  const parsed = createConsiliumSchema.safeParse(req.body);
  if (!parsed.success) throwZod(parsed);

  const consilium = await createConsilium(clinicId, {
    ...parsed.data,
    actorId: getCurrentUserId(),
  });
  res.status(201).json({ consilium });
});

export const listConsiliaController = asyncHandler(async (req, res) => {
  const clinicId = getCurrentClinicId();
  const parsed = listConsiliaQuerySchema.safeParse(req.query);
  if (!parsed.success) throwZod(parsed);

  const items = await listConsilia(clinicId, parsed.data);
  res.json({ items, count: items.length });
});

export const getConsiliumController = asyncHandler(async (req, res) => {
  const clinicId = getCurrentClinicId();
  const consilium = await getConsiliumById(clinicId, req.params.id);
  res.json({ consilium });
});

export const updateConsiliumController = asyncHandler(async (req, res) => {
  const clinicId = getCurrentClinicId();
  const parsed = updateConsiliumSchema.safeParse(req.body);
  if (!parsed.success) throwZod(parsed);

  const consilium = await updateConsilium(clinicId, req.params.id, {
    ...parsed.data,
    actorId: getCurrentUserId(),
  });
  res.json({ consilium });
});

export const archiveConsiliumController = asyncHandler(async (req, res) => {
  const clinicId = getCurrentClinicId();
  const consilium = await archiveConsilium(clinicId, req.params.id);
  res.json({ consilium });
});

// ─── Messages ───
export const listMessagesController = asyncHandler(async (req, res) => {
  const clinicId = getCurrentClinicId();
  const items = await listMessages(clinicId, req.params.id);
  res.json({ items, count: items.length });
});

export const createMessageController = asyncHandler(async (req, res) => {
  const clinicId = getCurrentClinicId();
  const parsed = createMessageSchema.safeParse(req.body);
  if (!parsed.success) throwZod(parsed);

  const message = await addMessage(clinicId, req.params.id, {
    ...parsed.data,
    actorId: getCurrentUserId(),
  });
  res.status(201).json({ message });
});
