// server/modules/video/controllers/video.controller.js
//
// Тонкие HTTP-обёртки каталога видео. Вся логика — в сервисе; здесь только
// разбор запроса и сборка актёра.
//
// КТО ТАКОЙ АКТЁР. Модуль работает и внутри клиники, и вне её, поэтому актёр
// собирается из двух источников: сессия говорит, кто пришёл, а tenantContext
// (если он есть) — от имени какой клиники и в какой роли. Порядок userId
// старше employeeId — тот же, что в tenantMiddleware и в модуле videra.

import { asyncHandler } from "../../../common/middlewares/errorHandler.js";
import { ValidationError } from "../../../common/utils/errors.js";
import * as service from "../services/video.service.js";
import {
  getPlaybackUrls,
  getPublicPlaybackUrls,
  recordWatch,
} from "../services/videoPlayback.service.js";
import * as generation from "../services/videoGeneration.service.js";
import { videoQuota, videoCost, grantMinutes } from "../services/videoQuota.service.js";
import { VIDEO_MINUTE_PACKS } from "../../../common/config/aiPlanLimits.js";
import {
  createVideoSchema,
  updateVideoSchema,
  publishVideoSchema,
  attachSchema,
  listVideosQuerySchema,
  publicListQuerySchema,
  watchSchema,
  draftFromDataSchema,
  reviewSchema,
  buyMinutesSchema,
} from "../validators/video.schemas.js";

function throwZod(parsed) {
  throw new ValidationError("Validation failed", {
    issues: parsed.error.issues.map((i) => ({ path: i.path, message: i.message })),
  });
}

/**
 * Действующее лицо запроса.
 *
 * clinicId берётся из tenantContext, а не из сессии напрямую: контекст
 * ставится только после того, как членство в клинике реально найдено и
 * подтверждено. Взять clinicId из сессии значило бы поверить cookie на слово.
 */
export function buildActor(req) {
  const ctx = req.tenantContext || {};
  const userId = req.session?.userId || null;
  const employeeId = req.session?.employeeId || null;

  return {
    ownerType: userId ? "user" : "employee",
    ownerId: userId || employeeId,
    clinicId: ctx.clinicId || null,
    role: ctx.role || null,
    permissions: ctx.permissions || null,
    membershipId: ctx.membershipId || null,
    email: req.user?.email || req.session?.email || null,
  };
}

export const createVideoController = asyncHandler(async (req, res) => {
  const parsed = createVideoSchema.safeParse(req.body);
  if (!parsed.success) throwZod(parsed);
  const video = await service.createVideo({
    actor: buildActor(req),
    data: parsed.data,
  });
  res.status(201).json({ video });
});

export const listVideosController = asyncHandler(async (req, res) => {
  const parsed = listVideosQuerySchema.safeParse(req.query);
  if (!parsed.success) throwZod(parsed);
  const { items } = await service.listVideos({
    actor: buildActor(req),
    query: parsed.data,
  });
  res.json({ items, count: items.length });
});

export const getVideoController = asyncHandler(async (req, res) => {
  const video = await service.getVideo({
    actor: buildActor(req),
    id: req.params.id,
  });
  res.json({ video });
});

export const updateVideoController = asyncHandler(async (req, res) => {
  const parsed = updateVideoSchema.safeParse(req.body);
  if (!parsed.success) throwZod(parsed);
  const video = await service.updateVideo({
    actor: buildActor(req),
    id: req.params.id,
    patch: parsed.data,
  });
  res.json({ video });
});

export const deleteVideoController = asyncHandler(async (req, res) => {
  const result = await service.deleteVideo({
    actor: buildActor(req),
    id: req.params.id,
  });
  res.json(result);
});

export const publishVideoController = asyncHandler(async (req, res) => {
  const parsed = publishVideoSchema.safeParse(req.body);
  if (!parsed.success) throwZod(parsed);
  const video = await service.publishVideo({
    actor: buildActor(req),
    id: req.params.id,
    visibility: parsed.data.visibility,
  });
  res.json({ video });
});

export const unpublishVideoController = asyncHandler(async (req, res) => {
  const video = await service.unpublishVideo({
    actor: buildActor(req),
    id: req.params.id,
  });
  res.json({ video });
});

export const attachVideoController = asyncHandler(async (req, res) => {
  const parsed = attachSchema.safeParse(req.body);
  if (!parsed.success) throwZod(parsed);
  const video = await service.attachVideo({
    actor: buildActor(req),
    id: req.params.id,
    ...parsed.data,
  });
  res.json({ video });
});

export const detachVideoController = asyncHandler(async (req, res) => {
  const parsed = attachSchema.safeParse(req.body);
  if (!parsed.success) throwZod(parsed);
  const video = await service.detachVideo({
    actor: buildActor(req),
    id: req.params.id,
    ...parsed.data,
  });
  res.json({ video });
});

/** Ролики, прикреплённые к сущности: «что показывали на этом приёме». */
export const listForEntityController = asyncHandler(async (req, res) => {
  const parsed = attachSchema.safeParse({
    entityType: req.params.entityType,
    entityId: req.params.entityId,
  });
  if (!parsed.success) throwZod(parsed);
  const { items } = await service.listVideosForEntity({
    actor: buildActor(req),
    ...parsed.data,
  });
  res.json({ items, count: items.length });
});

/* ── Воспроизведение ─────────────────────────────────────────────── */

export const playbackController = asyncHandler(async (req, res) => {
  const данные = await getPlaybackUrls({
    actor: buildActor(req),
    id: req.params.id,
  });
  // Ссылка живёт минуты — кэшировать ответ нельзя ни браузеру, ни прокси.
  res.set("Cache-Control", "no-store");
  res.json(данные);
});

export const watchController = asyncHandler(async (req, res) => {
  const parsed = watchSchema.safeParse(req.body);
  if (!parsed.success) throwZod(parsed);
  const итог = await recordWatch({
    actor: buildActor(req),
    id: req.params.id,
    watchedSec: parsed.data.watchedSec,
  });
  res.json(итог);
});

/* ── Расход и пакеты минут ───────────────────────────────────────── */

/**
 * Сколько минут потрачено, сколько осталось и во что это обошлось.
 *
 * Себестоимость показываем владельцу его же роликов: без неё «осталось
 * 4 минуты» — число без смысла, а с ней видно, что стоит за тарифом.
 */
export const quotaController = asyncHandler(async (req, res) => {
  const actor = buildActor(req);
  const User = (await import("../../../common/models/Auth/users.js")).default;
  const user =
    actor.ownerType === "user"
      ? await User.findById(actor.ownerId)
          .select("subscriptionPlan subscription videoRenderMinutesAddon")
          .lean()
      : null;

  const [quota, cost] = await Promise.all([
    videoQuota({ user, ownerType: actor.ownerType, ownerId: actor.ownerId }),
    videoCost({ ownerType: actor.ownerType, ownerId: actor.ownerId }),
  ]);
  res.json({ quota, cost, packs: VIDEO_MINUTE_PACKS });
});

/**
 * Купить пакет минут.
 *
 * Провайдер платежей живёт в mock-режиме, поэтому здесь только та половина,
 * которая от него не зависит: заявка и начисление после подтверждения.
 * Реальное списание подключится там же, где и остальные покупки, — счёт
 * выставляет modules/payments, а сюда приходит уже оплаченный факт.
 */
export const buyMinutesController = asyncHandler(async (req, res) => {
  const parsed = buyMinutesSchema.safeParse(req.body);
  if (!parsed.success) throwZod(parsed);

  const actor = buildActor(req);
  if (actor.ownerType !== "user") {
    throw new ValidationError("Пакет покупает человек, а не сотрудник клиники");
  }

  const pack = VIDEO_MINUTE_PACKS[parsed.data.pack];
  if (!pack) throw new ValidationError("Неизвестный пакет");

  const итог = await grantMinutes({
    userId: actor.ownerId,
    minutes: pack.minutes,
    reason: `Покупка пакета ${parsed.data.pack}`,
    paid: pack.price,
  });
  res.json(итог);
});

/* ── Машинная сборка ─────────────────────────────────────────────── */

export const draftFromDataController = asyncHandler(async (req, res) => {
  const parsed = draftFromDataSchema.safeParse(req.body);
  if (!parsed.success) throwZod(parsed);
  const video = await generation.draftFromData({
    actor: buildActor(req),
    data: parsed.data,
  });
  res.status(201).json({ video });
});

export const approveGeneratedController = asyncHandler(async (req, res) => {
  const parsed = reviewSchema.safeParse(req.body || {});
  if (!parsed.success) throwZod(parsed);
  const итог = await generation.approveGenerated({
    actor: buildActor(req),
    id: req.params.id,
    notes: parsed.data.notes,
  });
  res.json(итог);
});

export const rejectGeneratedController = asyncHandler(async (req, res) => {
  const parsed = reviewSchema.safeParse(req.body || {});
  if (!parsed.success) throwZod(parsed);
  const video = await generation.rejectGenerated({
    actor: buildActor(req),
    id: req.params.id,
    notes: parsed.data.notes,
  });
  res.json({ video });
});

/* ── Видео-визитка врача ─────────────────────────────────────────── */

export const setIntroController = asyncHandler(async (req, res) => {
  const итог = await service.setIntroVideo({
    actor: buildActor(req),
    id: req.params.id,
  });
  res.json(итог);
});

export const clearIntroController = asyncHandler(async (req, res) => {
  const итог = await service.clearIntroVideo({ actor: buildActor(req) });
  res.json(итог);
});

/** Воспроизведение публичного ролика. Без сессии. */
export const publicPlaybackController = asyncHandler(async (req, res) => {
  const данные = await getPublicPlaybackUrls({ id: req.params.id });
  res.set("Cache-Control", "no-store");
  res.json(данные);
});

/** Один публичный ролик — страница витрины. Без сессии. */
export const getPublicVideoController = asyncHandler(async (req, res) => {
  const video = await service.getPublicVideo({ id: req.params.id });
  res.json({ video });
});

/** Канал клиники на её публичной странице. Без сессии. */
export const listClinicPublicController = asyncHandler(async (req, res) => {
  const { items } = await service.listClinicPublicVideos({
    clinicId: req.params.clinicId,
  });
  res.json({ items, count: items.length });
});

/** Витрина. Единственный маршрут модуля без сессии. */
export const listPublicController = asyncHandler(async (req, res) => {
  const parsed = publicListQuerySchema.safeParse(req.query);
  if (!parsed.success) throwZod(parsed);
  const { items } = await service.listPublicVideos({ query: parsed.data });
  res.json({ items, count: items.length });
});
