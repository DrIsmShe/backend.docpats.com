// server/modules/education/education-translation/translation.controller.js
//
// Редакторский контур переводов. Для учащегося здесь ничего нет: он получает
// вопрос на своём языке обычной сборкой сессии, потому что перевод — это
// такой же ExamItem с другим lang.

import { z } from "zod";
import { asyncHandler } from "../../../common/middlewares/errorHandler.js";
import { ValidationError } from "../../../common/utils/errors.js";
import {
  translateItem,
  listTranslations,
  updateTranslation,
  unreviewTranslation,
} from "./translateItem.service.js";
import { enqueueItemTranslation } from "./translation.queue.js";
import { EXAM_LANGUAGES } from "../constants.js";
import ExamItem from "../education-items/models/examItem.model.js";

const langsSchema = z.object({
  langs: z.array(z.enum(EXAM_LANGUAGES)).min(1).optional(),
  force: z.boolean().optional(),
  // sync: дождаться результата вместо очереди. Нужно кнопке «перевести
  // сейчас» в админке: редактор нажал и хочет увидеть текст, а не «принято».
  sync: z.boolean().optional(),
});

const updateSchema = z.object({
  stem: z.string().trim().min(1).max(8000).optional(),
  explanation: z.string().trim().max(8000).optional(),
  options: z
    .array(z.object({ key: z.string().min(1).max(4), text: z.string().trim().min(1).max(2000) }))
    .optional(),
});

function parse(schema, body) {
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) {
    throw new ValidationError("Invalid payload", {
      issues: parsed.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      })),
    });
  }
  return parsed.data;
}

/** GET /items/:id/translations — состояние по всем языкам. */
export const listTranslationsController = asyncHandler(async (req, res) => {
  res.json(await listTranslations(req.params.id));
});

/** POST /items/:id/translations — перевести (в очередь или сразу). */
export const translateItemController = asyncHandler(async (req, res) => {
  const { langs = null, force = false, sync = false } = parse(langsSchema, req.body);
  const actorId = req.educationActor?.userId ?? null;

  if (sync) {
    const report = await translateItem(req.params.id, { langs, force, actorId });
    return res.json({ report });
  }

  const item = await ExamItem.findById(req.params.id).select("version").lean();
  if (!item) throw new ValidationError("Exam item not found");

  const queued = await enqueueItemTranslation({
    itemId: req.params.id,
    version: item.version,
    actorId,
    force,
  });
  res.status(202).json(queued);
});

/** PATCH /translations/:id — ручная правка. Переводит его в «проверено». */
export const updateTranslationController = asyncHandler(async (req, res) => {
  const data = parse(updateSchema, req.body);
  const item = await updateTranslation(req.params.id, {
    ...data,
    actorId: req.educationActor?.userId ?? null,
  });
  res.json({ item });
});

/** POST /translations/:id/unreview — снять «проверено». */
export const unreviewTranslationController = asyncHandler(async (req, res) => {
  const item = await unreviewTranslation(req.params.id, {
    actorId: req.educationActor?.userId ?? null,
  });
  res.json({ item });
});
