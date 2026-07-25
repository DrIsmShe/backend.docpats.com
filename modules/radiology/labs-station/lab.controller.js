// server/modules/radiology/labs-station/lab.controller.js

import { asyncHandler } from "../../../common/middlewares/errorHandler.js";
import { ValidationError } from "../../../common/utils/errors.js";
import { isAuthorRole } from "../middlewares/radiologyAuth.js";
import {
  createLabCase,
  updateLabCase,
  setLabStatus,
  listLabCases,
  getLabCaseFull,
  sanitizeLabForLearner,
  startLabAttempt,
  submitLabAttempt,
  getLabAttempt,
} from "./lab.service.js";
import LabCase from "./models/labCase.model.js";
import {
  createLabSchema,
  updateLabSchema,
  statusLabSchema,
  submitLabSchema,
  listLabQuerySchema,
} from "./lab.schemas.js";
import { NotFoundError } from "../../../common/utils/errors.js";

function throwZod(parsed) {
  throw new ValidationError("Validation failed", {
    issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
  });
}

export const listLabCasesController = asyncHandler(async (req, res) => {
  const parsed = listLabQuerySchema.safeParse(req.query);
  if (!parsed.success) throwZod(parsed);
  const items = await listLabCases({
    isEditor: isAuthorRole(req.radiologyActor.role),
    scope: parsed.data.scope,
    status: parsed.data.status,
  });
  res.json({ items, count: items.length });
});

export const createLabCaseController = asyncHandler(async (req, res) => {
  const parsed = createLabSchema.safeParse(req.body);
  if (!parsed.success) throwZod(parsed);
  const doc = await createLabCase(parsed.data, req.radiologyActor.userId, req.radiologyActor.role);
  res.status(201).json({ case: doc });
});

export const getLabCaseController = asyncHandler(async (req, res) => {
  if (isAuthorRole(req.radiologyActor.role)) {
    return res.json({ case: await getLabCaseFull(req.params.id), full: true });
  }
  const doc = await LabCase.findById(req.params.id).lean();
  if (!doc || doc.status !== "published") throw new NotFoundError("Lab case");
  res.json({ case: sanitizeLabForLearner(doc), full: false });
});

export const updateLabCaseController = asyncHandler(async (req, res) => {
  const parsed = updateLabSchema.safeParse(req.body);
  if (!parsed.success) throwZod(parsed);
  res.json({ case: await updateLabCase(req.params.id, parsed.data) });
});

export const statusLabCaseController = asyncHandler(async (req, res) => {
  const parsed = statusLabSchema.safeParse(req.body);
  if (!parsed.success) throwZod(parsed);
  const doc = await setLabStatus(
    req.params.id,
    parsed.data.status,
    req.radiologyActor.userId,
    req.radiologyActor.role,
  );
  res.json({ case: doc });
});

export const startLabAttemptController = asyncHandler(async (req, res) => {
  res.status(201).json(await startLabAttempt(req.params.id, req.radiologyActor.userId));
});

export const submitLabAttemptController = asyncHandler(async (req, res) => {
  const parsed = submitLabSchema.safeParse(req.body ?? {});
  if (!parsed.success) throwZod(parsed);
  res.json(await submitLabAttempt(req.params.id, req.radiologyActor.userId, parsed.data));
});

export const getLabAttemptController = asyncHandler(async (req, res) => {
  res.json(await getLabAttempt(req.params.id, req.radiologyActor.userId));
});
