// server/modules/video/controllers/videoConsent.controller.js
//
// HTTP-обёртки видео-согласия. Актёр собирается тем же buildActor, что и в
// каталоге: сессия говорит кто, tenantContext — от имени какой клиники.

import { asyncHandler } from "../../../common/middlewares/errorHandler.js";
import { ValidationError } from "../../../common/utils/errors.js";
import { buildActor } from "./video.controller.js";
import * as service from "../services/videoConsent.service.js";
import {
  requestConsentSchema,
  revokeConsentSchema,
  listConsentsQuerySchema,
} from "../validators/videoConsent.schemas.js";

function throwZod(parsed) {
  throw new ValidationError("Validation failed", {
    issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
  });
}

export const requestConsentController = asyncHandler(async (req, res) => {
  const parsed = requestConsentSchema.safeParse(req.body);
  if (!parsed.success) throwZod(parsed);
  const consent = await service.requestConsent({
    actor: buildActor(req),
    data: parsed.data,
  });
  res.status(201).json({ consent });
});

/** Кабинет пациента: что нужно посмотреть и подписать. */
export const listMyConsentsController = asyncHandler(async (req, res) => {
  const parsed = listConsentsQuerySchema.safeParse(req.query);
  if (!parsed.success) throwZod(parsed);
  const { items } = await service.listMyConsents({
    actor: buildActor(req),
    status: parsed.data.status,
  });
  res.json({ items, count: items.length });
});

/** Карта пациента в клинике: история согласий. */
export const listPatientConsentsController = asyncHandler(async (req, res) => {
  const { items } = await service.listPatientConsents({
    actor: buildActor(req),
    clinicPatientId: req.params.clinicPatientId,
  });
  res.json({ items, count: items.length });
});

export const getConsentController = asyncHandler(async (req, res) => {
  const consent = await service.getConsent({
    actor: buildActor(req),
    id: req.params.id,
  });
  res.json({ consent });
});

export const signConsentController = asyncHandler(async (req, res) => {
  const consent = await service.signConsent({
    actor: buildActor(req),
    id: req.params.id,
  });
  res.json({ consent });
});

export const revokeConsentController = asyncHandler(async (req, res) => {
  const parsed = revokeConsentSchema.safeParse(req.body || {});
  if (!parsed.success) throwZod(parsed);
  const consent = await service.revokeConsent({
    actor: buildActor(req),
    id: req.params.id,
    reason: parsed.data.reason,
  });
  res.json({ consent });
});
