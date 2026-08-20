// server/modules/webinar/routes/webinar.routes.js

import { Router } from "express";
import { z } from "zod";

import { asyncHandler } from "../../../common/middlewares/errorHandler.js";
import authMiddleware from "../../../common/middlewares/authMiddleware.js";
import requireDoctorRole from "../../../common/middlewares/requireDoctorRole.js";
import { ValidationError } from "../../../common/utils/errors.js";
import * as service from "../services/webinar.service.js";

/* ============================================================
   МАРШРУТЫ ВЕБИНАРОВ — /api/webinars
   ============================================================
   Создавать встречи может только врач: вебинар — рабочий
   инструмент клиники, а не общая переговорка.

   Заходить внутрь может любой авторизованный, кого пускают
   правила встречи, — пациент в том числе. Поэтому на входе
   authMiddleware, а не requireDoctorRole.

   Гости без аккаунта пока не поддерживаются. Пускать в
   медицинскую встречу по одной ссылке без опознания — это
   отдельное решение с подписанными ссылками и сроком жизни,
   как у /previsit и /pay. Тихо разрешать такое нельзя.
   ============================================================ */

const objectId = z.string().regex(/^[a-f\d]{24}$/i, "Некорректный id");

const createSchema = z
  .object({
    title: z.string().trim().min(2).max(200),
    description: z.string().trim().max(2000).optional().default(""),
    accessMode: z.enum(["link", "invited"]).optional().default("link"),
    invitedUserIds: z.array(objectId).optional().default([]),
    coHostIds: z.array(objectId).optional().default([]),
    lobbyEnabled: z.boolean().optional().default(false),
    scheduledAt: z.string().datetime().nullable().optional().default(null),
    maxParticipants: z.number().int().min(2).max(500).optional(),
  })
  .strict();

const updateSchema = createSchema
  .partial()
  .extend({ status: z.enum(["scheduled", "live", "ended"]).optional() })
  .strict();

function validate(schema, target = "body") {
  return (req, _res, next) => {
    const result = schema.safeParse(req[target]);
    if (!result.success) {
      const fields = {};
      for (const issue of result.error.issues) {
        fields[issue.path.join(".") || "_root"] = issue.message;
      }
      return next(new ValidationError(`Некорректный ${target}`, { fields }));
    }
    req[target] = result.data;
    return next();
  };
}

const router = Router();

// ── Список своих встреч ──────────────────────────────────────
router.get(
  "/",
  authMiddleware,
  asyncHandler(async (req, res) => {
    const items = await service.listWebinars(req.user.userId);
    res.json({ success: true, items });
  }),
);

// ── Создать ──────────────────────────────────────────────────
router.post(
  "/",
  requireDoctorRole,
  validate(createSchema),
  asyncHandler(async (req, res) => {
    const webinar = await service.createWebinar({
      hostId: req.userId,
      data: req.body,
    });
    res.status(201).json({ success: true, webinar });
  }),
);

// ── Карточка для страницы входа ──────────────────────────────
router.get(
  "/:id",
  authMiddleware,
  asyncHandler(async (req, res) => {
    const webinar = await service.getWebinarForJoin({
      webinarId: req.params.id,
      userId: req.user.userId,
    });
    res.json({ success: true, webinar });
  }),
);

// ── Пропуск в комнату ────────────────────────────────────────
router.post(
  "/:id/token",
  authMiddleware,
  asyncHandler(async (req, res) => {
    const result = await service.issueWebinarToken({
      webinarId: req.params.id,
      userId: req.user.userId,
      displayName: req.body?.displayName || null,
      email: req.user.email || null,
    });
    res.json(result);
  }),
);

// ── Изменить / завершить ─────────────────────────────────────
router.patch(
  "/:id",
  requireDoctorRole,
  validate(updateSchema),
  asyncHandler(async (req, res) => {
    const webinar = await service.updateWebinar({
      webinarId: req.params.id,
      userId: req.userId,
      patch: req.body,
    });
    res.json({ success: true, webinar });
  }),
);

// ── Удалить ──────────────────────────────────────────────────
router.delete(
  "/:id",
  requireDoctorRole,
  asyncHandler(async (req, res) => {
    await service.deleteWebinar({
      webinarId: req.params.id,
      userId: req.userId,
    });
    res.json({ success: true });
  }),
);

export default router;
