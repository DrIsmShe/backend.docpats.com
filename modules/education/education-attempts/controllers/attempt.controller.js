// server/modules/education/education-attempts/controllers/attempt.controller.js
//
// Контур учащегося. userId берётся ИЗ СЕССИИ, никогда из тела запроса —
// иначе чужую попытку можно было бы открыть, подставив id.

import { asyncHandler } from "../../../../common/middlewares/errorHandler.js";
import { ValidationError } from "../../../../common/utils/errors.js";
import {
  startAttempt,
  getAttemptForLearner,
  answerQuestion,
  submitAttempt,
  listAttempts,
  getReadiness,
} from "../services/attempt.service.js";
import {
  startAttemptSchema,
  answerSchema,
  listAttemptsQuerySchema,
} from "../validators/attempt.schemas.js";

function throwZod(parsed) {
  throw new ValidationError("Validation failed", {
    issues: parsed.error.issues.map((i) => ({
      path: i.path,
      message: i.message,
    })),
  });
}

export const startAttemptController = asyncHandler(async (req, res) => {
  const parsed = startAttemptSchema.safeParse(req.body);
  if (!parsed.success) throwZod(parsed);

  const attempt = await startAttempt({
    ...parsed.data,
    userId: req.educationActor.userId,
    // Если учащийся проходит назначенный клиникой курс — сессия несёт clinicId.
    clinicId: req.session?.clinicId ?? null,
  });

  // Возвращаем безопасную проекцию, а не сырой документ: сырой содержит
  // состав попытки, по которому можно вытянуть вопросы вне интерфейса.
  const view = await getAttemptForLearner(
    attempt._id,
    req.educationActor.userId,
  );
  res.status(201).json({ attempt: view });
});

export const getAttemptController = asyncHandler(async (req, res) => {
  const attempt = await getAttemptForLearner(
    req.params.id,
    req.educationActor.userId,
  );
  res.json({ attempt });
});

export const answerController = asyncHandler(async (req, res) => {
  const parsed = answerSchema.safeParse(req.body);
  if (!parsed.success) throwZod(parsed);

  const result = await answerQuestion(
    req.params.id,
    req.educationActor.userId,
    parsed.data,
  );
  res.json(result);
});

export const submitAttemptController = asyncHandler(async (req, res) => {
  await submitAttempt(req.params.id, req.educationActor.userId);
  const attempt = await getAttemptForLearner(
    req.params.id,
    req.educationActor.userId,
  );
  res.json({ attempt });
});

export const listAttemptsController = asyncHandler(async (req, res) => {
  const parsed = listAttemptsQuerySchema.safeParse(req.query);
  if (!parsed.success) throwZod(parsed);

  const items = await listAttempts(req.educationActor.userId, parsed.data);
  res.json({ items, count: items.length });
});

// Главный экран подготовки: готовность по темам blueprint.
export const readinessController = asyncHandler(async (req, res) => {
  const readiness = await getReadiness(
    req.educationActor.userId,
    req.params.programId,
  );
  res.json({ readiness });
});
