// server/modules/radiology/virtual-patient/vp.controller.js

import { asyncHandler } from "../../../common/middlewares/errorHandler.js";
import { ValidationError, NotFoundError } from "../../../common/utils/errors.js";
import { isAuthorRole } from "../middlewares/radiologyAuth.js";
import VirtualPatientCase from "./models/vpCase.model.js";
import {
  createVpCase,
  updateVpCase,
  setVpStatus,
  listVpCases,
  getVpCaseFull,
  sanitizeVpForLearner,
  startVpAttempt,
  orderInvestigation,
  submitVpAttempt,
  getVpAttempt,
} from "./vp.service.js";
import { generateVpCase } from "../ai/caseGenerator.js";
import {
  createVpSchema,
  updateVpSchema,
  statusVpSchema,
  orderVpSchema,
  submitVpSchema,
  listVpQuerySchema,
  aiGenerateVpSchema,
} from "./vp.schemas.js";

function throwZod(parsed) {
  throw new ValidationError("Validation failed", {
    issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
  });
}

export const listVpController = asyncHandler(async (req, res) => {
  const parsed = listVpQuerySchema.safeParse(req.query);
  if (!parsed.success) throwZod(parsed);
  const items = await listVpCases({
    isEditor: isAuthorRole(req.radiologyActor.role),
    scope: parsed.data.scope,
    status: parsed.data.status,
  });
  res.json({ items, count: items.length });
});

// ИИ-генерация сценария ЦЕЛИКОМ по теме. Только автору. Ничего не сохраняет:
// возвращает заготовку для формы — автор проверяет и сохраняет сам.
export const aiGenerateVpController = asyncHandler(async (req, res) => {
  const parsed = aiGenerateVpSchema.safeParse(req.body ?? {});
  if (!parsed.success) throwZod(parsed);
  const draft = await generateVpCase(parsed.data);
  res.json({ draft });
});

export const createVpController = asyncHandler(async (req, res) => {
  const parsed = createVpSchema.safeParse(req.body);
  if (!parsed.success) throwZod(parsed);
  const doc = await createVpCase(parsed.data, req.radiologyActor.userId, req.radiologyActor.role);
  res.status(201).json({ case: doc });
});

export const getVpController = asyncHandler(async (req, res) => {
  if (isAuthorRole(req.radiologyActor.role)) {
    return res.json({ case: await getVpCaseFull(req.params.id), full: true });
  }
  const doc = await VirtualPatientCase.findById(req.params.id).lean();
  if (!doc || doc.status !== "published") throw new NotFoundError("VP case");
  res.json({ case: sanitizeVpForLearner(doc), full: false });
});

export const updateVpController = asyncHandler(async (req, res) => {
  const parsed = updateVpSchema.safeParse(req.body);
  if (!parsed.success) throwZod(parsed);
  res.json({ case: await updateVpCase(req.params.id, parsed.data) });
});

export const statusVpController = asyncHandler(async (req, res) => {
  const parsed = statusVpSchema.safeParse(req.body);
  if (!parsed.success) throwZod(parsed);
  const doc = await setVpStatus(req.params.id, parsed.data.status, req.radiologyActor.userId, req.radiologyActor.role);
  res.json({ case: doc });
});

export const startVpController = asyncHandler(async (req, res) => {
  res.status(201).json(await startVpAttempt(req.params.id, req.radiologyActor.userId));
});

export const orderVpController = asyncHandler(async (req, res) => {
  const parsed = orderVpSchema.safeParse(req.body ?? {});
  if (!parsed.success) throwZod(parsed);
  const result = await orderInvestigation(req.params.id, req.radiologyActor.userId, parsed.data.key);
  res.json({ investigation: result });
});

export const submitVpController = asyncHandler(async (req, res) => {
  const parsed = submitVpSchema.safeParse(req.body ?? {});
  if (!parsed.success) throwZod(parsed);
  res.json(await submitVpAttempt(req.params.id, req.radiologyActor.userId, parsed.data));
});

export const getVpAttemptController = asyncHandler(async (req, res) => {
  res.json(await getVpAttempt(req.params.id, req.radiologyActor.userId));
});
