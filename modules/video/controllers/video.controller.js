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
  importStudioSchema,
  subscribeSchema,
  reportSchema,
  resolveReportSchema,
  transcribeSchema,
  watchSchema,
  draftFromDataSchema,
  reviewSchema,
  buyMinutesSchema,
  prepareUploadSchema,
  completeUploadSchema,
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

/* ── Отклик и загрузка ───────────────────────────────────────────── */

/** Отметка «полезно» — переключателем. */
export const likeController = asyncHandler(async (req, res) => {
  const итог = await service.toggleLike({ actor: buildActor(req), id: req.params.id });
  res.json(итог);
});

/** Правила публикации и текущая редакция. Отдаются без входа: их читают
    до того, как решают загружать. */
export const uploadRulesController = asyncHandler(async (_req, res) => {
  const { ВЕРСИЯ_ПРАВИЛ, ТЕМЫ_РАЗРЕШЕНЫ, ЗАПРЕЩЕНО, ТРЕБОВАНИЯ, ОТВЕТСТВЕННОСТЬ } =
    await import("../uploadRules.js");
  const { МАКС_СЕКУНД, МАКС_БАЙТ, ТИПЫ } = await import(
    "../services/videoUpload.service.js"
  );
  res.json({
    version: ВЕРСИЯ_ПРАВИЛ,
    topics: ТЕМЫ_РАЗРЕШЕНЫ,
    forbidden: ЗАПРЕЩЕНО,
    requirements: ТРЕБОВАНИЯ,
    liability: ОТВЕТСТВЕННОСТЬ,
    limits: {
      maxSeconds: МАКС_СЕКУНД,
      maxBytes: МАКС_БАЙТ,
      mimeTypes: Object.keys(ТИПЫ),
    },
  });
});

export const prepareUploadController = asyncHandler(async (req, res) => {
  const parsed = prepareUploadSchema.safeParse(req.body);
  if (!parsed.success) throwZod(parsed);
  const { prepareUpload } = await import("../services/videoUpload.service.js");
  const итог = await prepareUpload({ actor: buildActor(req), data: parsed.data });
  res.set("Cache-Control", "no-store");
  res.status(201).json(итог);
});

export const completeUploadController = asyncHandler(async (req, res) => {
  const parsed = completeUploadSchema.safeParse(req.body);
  if (!parsed.success) throwZod(parsed);
  const { completeUpload } = await import("../services/videoUpload.service.js");
  const video = await completeUpload({
    actor: buildActor(req),
    id: parsed.data.videoId,
  });
  res.json({ video });
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
  // Зритель нужен ровно для одного: показать, отмечал ли он этот ролик.
  // Страница остаётся публичной — без сессии просто нет отметки.
  const video = await service.getPublicVideo({
    id: req.params.id,
    viewerId: req.session?.userId || null,
  });
  res.json({ video });
});

/** Канал клиники на её публичной странице. Без сессии. */
export const listClinicPublicController = asyncHandler(async (req, res) => {
  const { items } = await service.listClinicPublicVideos({
    clinicId: req.params.clinicId,
  });
  res.json({ items, count: items.length });
});

/** Разделы, в которые ЭТОТ человек может публиковать. */
export const publishableCategoriesController = asyncHandler(async (req, res) => {
  const { listPublishableCategories } = await import(
    "../services/videoCategory.service.js"
  );
  const итог = await listPublishableCategories({
    actor: buildActor(req),
    lang: String(req.query.lang || "ru"),
  });
  res.json({ ...итог, count: итог.items.length });
});

/** Разделы витрины — открыто: по ним строятся чипсы и меню ленты. */
export const categoriesController = asyncHandler(async (req, res) => {
  const { listCategories } = await import("../services/videoCategory.service.js");
  const { items } = await listCategories({
    lang: String(req.query.lang || "ru"),
    withCounts: req.query.counts === "true",
  });
  res.json({ items, count: items.length });
});

/**
 * Лента «по интересам».
 *
 * Открыта без сессии: гость увидит свежее. Вошедшему подбираем по тому,
 * что он сам смотрел и на кого подписан — см. videoFeed.service.js.
 */
export const recommendedController = asyncHandler(async (req, res) => {
  const { рекомендации } = await import("../services/videoFeed.service.js");
  const items = await рекомендации({
    viewer: req.session?.userId ? buildActor(req) : null,
    limit: Math.min(Number(req.query.limit) || 24, 100),
    lang: String(req.query.lang || ""),
  });

  const { сИменамиИПостерами } = await import("../services/video.service.js");
  res.json({ items: await сИменамиИПостерами(items), count: items.length });
});

/** Похожие ролики — колонка справа на странице ролика. */
export const relatedController = asyncHandler(async (req, res) => {
  const { getPublicVideoRaw, сИменамиИПостерами } = await import(
    "../services/video.service.js"
  );
  const video = await getPublicVideoRaw(req.params.id);

  const { похожие } = await import("../services/videoFeed.service.js");
  const items = await похожие({
    video,
    viewerId: req.session?.userId || null,
    limit: Math.min(Number(req.query.limit) || 12, 50),
  });

  res.json({ items: await сИменамиИПостерами(items), count: items.length });
});

/**
 * Пожаловаться на ролик или комментарий.
 *
 * Жалоба ничего не скрывает сама — она ставит материал в очередь разбора.
 * Ответ короткий: человеку важно знать, что заявление принято.
 */
export const reportController = asyncHandler(async (req, res) => {
  const parsed = reportSchema.safeParse(req.body);
  if (!parsed.success) throwZod(parsed);

  const { report } = await import("../services/contentReport.service.js");
  const жалоба = await report({ actor: buildActor(req), data: parsed.data });
  res.status(201).json({ id: жалоба._id, status: жалоба.status });
});

/** Очередь разбора — только администратору площадки. */
export const listReportsController = asyncHandler(async (req, res) => {
  const { listReports } = await import("../services/contentReport.service.js");
  const { items } = await listReports({ actor: buildActor(req), query: req.query });
  res.json({ items, count: items.length });
});

/** Решение по жалобе. */
export const resolveReportController = asyncHandler(async (req, res) => {
  const parsed = resolveReportSchema.safeParse(req.body);
  if (!parsed.success) throwZod(parsed);

  const { resolveReport } = await import("../services/contentReport.service.js");
  const жалоба = await resolveReport({
    actor: buildActor(req),
    id: req.params.id,
    ...parsed.data,
  });
  res.json(жалоба);
});

/**
 * Страница плеера для чужого сайта.
 *
 * Единственное место приложения, которому разрешено открываться внутри
 * <iframe>, поэтому заголовки ставятся здесь поштучно, а не глобально:
 * frame-ancestors * только для этой страницы, X-Frame-Options снимается —
 * старый заголовок не умеет «всем, кроме» и перекрыл бы разрешение.
 */
export const embedPageController = asyncHandler(async (req, res) => {
  const { embedPage } = await import("../services/videoEmbed.service.js");
  const html = await embedPage(req.params.id);

  res.removeHeader("X-Frame-Options");
  res.setHeader("Content-Security-Policy", "frame-ancestors *");
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  // Ссылка на файл подписана на час — страницу дольше держать нельзя,
  // иначе фрейм покажет протухший адрес.
  res.setHeader("Cache-Control", "public, max-age=600");
  res.send(html);
});

/** Код для вставки — его копирует автор на странице ролика. */
export const embedCodeController = asyncHandler(async (req, res) => {
  const { embedData, embedCode } = await import("../services/videoEmbed.service.js");
  // Проверяем доступность до выдачи кода: дать код на ролик, который не
  // встроится, — это отправить человека отлаживать чужую страницу.
  await embedData(req.params.id);
  res.json(embedCode(req.params.id));
});

/**
 * Распознать речь и приложить субтитры.
 *
 * Долгая операция: файл скачивается, распознаётся и переводится
 * на каждый выбранный язык. Ответ говорит, какие дорожки легли,
 * а какие языки не вышли — молчаливый частичный успех хуже отказа.
 */
export const transcribeController = asyncHandler(async (req, res) => {
  const parsed = transcribeSchema.safeParse(req.body || {});
  if (!parsed.success) throwZod(parsed);

  const { transcribeVideo } = await import("../services/videoTranscribe.service.js");
  const итог = await transcribeVideo({
    actor: buildActor(req),
    id: req.params.id,
    targets: parsed.data.targets || [],
    lang: parsed.data.lang || "",
  });
  res.json(итог);
});

/**
 * Где теперь фильм студии. Спрашивает сама студия, чтобы
 * переадресовать старую ссылку в каталог. 404 — нормальный ответ:
 * фильм мог так и не попасть в каталог.
 */
export const byStudioFilmController = asyncHandler(async (req, res) => {
  const video = await service.findPublicByStudioFilm(req.params.filmId);
  if (!video) return res.status(404).json({ message: "Ролик не найден" });
  res.json({ id: video._id, title: video.title });
});

/**
 * Просмотр публичного ролика — счётчик витрины.
 *
 * Отвечает новым числом, чтобы страница показала его сразу, а не ждала
 * перезагрузки.
 */
export const publicViewController = asyncHandler(async (req, res) => {
  const итог = await service.countPublicView({
    id: req.params.id,
    viewerId: req.session?.userId || null,
  });
  res.json(итог);
});

/**
 * Обсуждение под опубликованным роликом — открыто без входа.
 *
 * Читать может любой, писать — нет: форма ответа появляется только у
 * вошедшего, и создание комментария по-прежнему идёт общим маршрутом со
 * своей проверкой.
 */
export const publicCommentsController = asyncHandler(async (req, res) => {
  // Сначала убеждаемся, что ролик открыт: иначе этот вход стал бы
  // способом читать обсуждение под чужим черновиком.
  const { getPublicVideoRaw } = await import("../services/video.service.js");
  await getPublicVideoRaw(req.params.id);

  const { собратьДерево } = await import(
    "../../commentsLikes/controllers/commentController/commentController.js"
  );
  const дерево = await собратьДерево(req.params.id);

  /**
   * Шифротекст имён наружу не отдаём.
   *
   * Сборка дерева расшифровывает имя и кладёт рядом, а исходные
   * поля остаются — в кабинете это безразлично, а здесь ответ читает
   * кто угодно. Шифрованное значение бесполезно читателю и
   * полезно тому, кто собирает шифротексты для анализа.
   */
  const почистить = (список) =>
    (список || []).map((к) => {
      const { author, replies, ...остальное } = к;
      const автор = author
        ? {
            _id: author._id,
            firstName: author.firstName || "",
            lastName: author.lastName || "",
            avatar: author.avatar || null,
            username: author.username || null,
          }
        : null;
      return { ...остальное, author: автор, replies: почистить(replies) };
    });

  res.json({ success: true, comments: почистить(дерево) });
});

/** Сводка по всем своим роликам — чтобы видеть, какой проседает. */
export const statsController = asyncHandler(async (req, res) => {
  const { statsForOwner } = await import("../services/videoStats.service.js");
  const итог = await statsForOwner({
    actor: buildActor(req),
    days: Math.min(Number(req.query.days) || 30, 365),
  });
  res.json(итог);
});

/** Подробно по одному ролику: где бросают и досматривают ли. */
export const videoStatsController = asyncHandler(async (req, res) => {
  const { statsForVideo } = await import("../services/videoStats.service.js");
  const итог = await statsForVideo({
    actor: buildActor(req),
    id: req.params.id,
    days: Math.min(Number(req.query.days) || 30, 365),
  });
  res.json(итог);
});

/**
 * Загрузка через сервер — запасной путь.
 *
 * Нужен, пока бакет не разрешает запись с нашего домена: браузер
 * получает 403 на preflight, и прямая загрузка невозможна при
 * исправных сервере и хранилище.
 */
export const directUploadController = asyncHandler(async (req, res) => {
  const { directUpload } = await import("../services/videoDirectUpload.service.js");

  const video = await directUpload({
    actor: buildActor(req),
    file: req.file,
    data: {
      title: req.body.title,
      description: req.body.description,
      lang: req.body.lang,
      kind: req.body.kind,
      categoryId: req.body.categoryId || null,
      phi: req.body.phi === "true",
      durationSec: req.body.durationSec,
      rulesVersion: req.body.rulesVersion,
      termsAccepted: req.body.termsAccepted,
      poster: req.body.poster,
    },
  });

  res.status(201).json(video);
});

/** Витрина. Единственный маршрут модуля без сессии. */
export const listPublicController = asyncHandler(async (req, res) => {
  const parsed = publicListQuerySchema.safeParse(req.query);
  if (!parsed.success) throwZod(parsed);

  // Лента подписок доступна только вошедшему: у гостя нет подписок, и
  // отдавать ему вместо них весь каталог — врать про то, что он видит.
  const { items } = await service.listPublicVideos({
    query: parsed.data,
    viewer: req.session?.userId ? buildActor(req) : null,
  });
  res.json({ items, count: items.length });
});

/**
 * Отметка «не помогло».
 *
 * Отдельный маршрут, а не параметр у лайка: так у действия свой след в
 * журнале и своя строка в правах, если завтра минусы придётся ограничить.
 */
export const dislikeController = asyncHandler(async (req, res) => {
  const итог = await service.toggleDislike({ actor: buildActor(req), id: req.params.id });
  res.json(итог);
});

/** Подписаться на канал или отписаться — одно действие, как и кнопка. */
export const subscribeController = asyncHandler(async (req, res) => {
  const parsed = subscribeSchema.safeParse(req.body);
  if (!parsed.success) throwZod(parsed);

  const { toggleSubscription } = await import("../services/videoSubscription.service.js");
  const итог = await toggleSubscription({ actor: buildActor(req), ...parsed.data });
  res.json(итог);
});

/** Мои каналы с именами и кадрами — для страницы «Подписки». */
export const myChannelsController = asyncHandler(async (req, res) => {
  const { myChannels } = await import("../services/videoSubscription.service.js");
  const items = await myChannels({ actor: buildActor(req) });
  res.json({ items, count: items.length });
});

/** Мои каналы — для страницы «Подписки» и для отметок в интерфейсе. */
export const mySubscriptionsController = asyncHandler(async (req, res) => {
  const { listMySubscriptions } = await import("../services/videoSubscription.service.js");
  const items = await listMySubscriptions({ actor: buildActor(req) });
  res.json({ items, count: items.length });
});

/**
 * Перенести фильм из студии в каталог.
 *
 * Долгая операция: файл действительно скачивается к нам и кладётся в
 * хранилище. Ответ — созданная запись, чтобы страница сразу показала
 * ролик, а не отправляла человека обновлять список.
 */
export const importStudioController = asyncHandler(async (req, res) => {
  const parsed = importStudioSchema.safeParse(req.body);
  if (!parsed.success) throwZod(parsed);

  const { importFromStudio } = await import("../services/videoImport.service.js");
  const video = await importFromStudio({ actor: buildActor(req), data: parsed.data });
  res.status(201).json(video);
});
