// server/modules/feedback/controllers/feedback.controller.js
//
// Тонкие HTTP-обёртки обратной связи. Логика — в сервисе; здесь разбор
// запроса, сборка актёра и снятие технического окружения.
//
// ОКРУЖЕНИЕ СНИМАЕТ СЕРВЕР, А НЕ КЛИЕНТ. Браузер пришлёт что угодно, а для
// разбора ошибки важно то, что на самом деле пришло на сервер. Адрес
// страницы — исключение: одностраничное приложение не отражает его ни в
// каком заголовке, и его приходится брать из тела запроса.

import { asyncHandler } from "../../../common/middlewares/errorHandler.js";
import { ValidationError } from "../../../common/utils/errors.js";
import * as service from "../services/feedback.service.js";
import { ШАБЛОНЫ } from "../services/feedbackTexts.js";
import { ВИДЫ, РАЗДЕЛЫ, СОСТОЯНИЯ } from "../models/feedback.model.js";
import {
  createFeedbackSchema,
  replySchema,
  adminReplySchema,
  statusSchema,
  listQuerySchema,
} from "../validators/feedback.schemas.js";

function throwZod(parsed) {
  throw new ValidationError("Validation failed", {
    issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
  });
}

/* Актёр собирается так же, как в модуле видео: userId старше employeeId —
   тот же порядок, что в tenantMiddleware. */
function buildActor(req) {
  const ctx = req.tenantContext || {};
  const userId = req.session?.userId || null;
  const employeeId = req.session?.employeeId || null;

  return {
    ownerType: userId ? "user" : "employee",
    ownerId: userId || employeeId,
    clinicId: ctx.clinicId || null,
    role: ctx.role || null,
  };
}

/* ── Автор ────────────────────────────────────────────────────────── */

export const createController = asyncHandler(async (req, res) => {
  const parsed = createFeedbackSchema.safeParse(req.body);
  if (!parsed.success) throwZod(parsed);

  const обращение = await service.создать({
    actor: buildActor(req),
    data: parsed.data,
    context: {
      url: parsed.data.url,
      userAgent: req.get("user-agent") || "",
    },
  });

  res.status(201).json({ feedback: обращение });
});

export const myListController = asyncHandler(async (req, res) => {
  const items = await service.мои({
    actor: buildActor(req),
    status: req.query.status || null,
    limit: req.query.limit,
  });
  res.json({ items, count: items.length });
});

export const myOneController = asyncHandler(async (req, res) => {
  const обращение = await service.одно({
    actor: buildActor(req),
    id: req.params.id,
  });
  res.json({ feedback: обращение });
});

export const replyController = asyncHandler(async (req, res) => {
  const parsed = replySchema.safeParse(req.body);
  if (!parsed.success) throwZod(parsed);

  const обращение = await service.дописать({
    actor: buildActor(req),
    id: req.params.id,
    text: parsed.data.text,
  });
  res.json({ feedback: обращение });
});

/* Справочник для формы: виды, разделы, язык. Отдаётся сервером, чтобы
   список в форме не разошёлся со списком, который принимает схема. */
export const dictionaryController = asyncHandler(async (_req, res) => {
  res.json({ kinds: ВИДЫ, areas: РАЗДЕЛЫ, statuses: СОСТОЯНИЯ });
});

/* ── Разбор ───────────────────────────────────────────────────────── */

export const queueController = asyncHandler(async (req, res) => {
  const parsed = listQuerySchema.safeParse(req.query);
  if (!parsed.success) throwZod(parsed);

  const [очередь, сводка] = await Promise.all([
    service.очередь(parsed.data),
    service.сводка(),
  ]);

  res.json({ ...очередь, summary: сводка });
});

export const cardController = asyncHandler(async (req, res) => {
  const обращение = await service.карточка(req.params.id);
  res.json({ feedback: обращение });
});

export const adminReplyController = asyncHandler(async (req, res) => {
  const parsed = adminReplySchema.safeParse(req.body);
  if (!parsed.success) throwZod(parsed);

  const обращение = await service.ответить({
    adminId: req.session.userId,
    id: req.params.id,
    text: parsed.data.text || "",
    templateKey: parsed.data.templateKey || null,
  });
  res.json({ feedback: обращение });
});

export const statusController = asyncHandler(async (req, res) => {
  const parsed = statusSchema.safeParse(req.body);
  if (!parsed.success) throwZod(parsed);

  const обращение = await service.сменитьСостояние({
    adminId: req.session.userId,
    id: req.params.id,
    status: parsed.data.status,
    resolution: parsed.data.resolution || "",
    priority: parsed.data.priority || null,
    autoReply: parsed.data.autoReply !== false,
  });
  res.json({ feedback: обращение });
});

/* Заготовки ответов: администратору показываем русские названия и русский
   текст — на язык обращения перевод сделает сервис при отправке. */
export const templatesController = asyncHandler(async (_req, res) => {
  res.json({
    items: ШАБЛОНЫ.map((ш) => ({ key: ш.key, title: ш.title, preview: ш.text.ru })),
  });
});
