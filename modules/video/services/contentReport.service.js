// server/modules/video/services/contentReport.service.js
//
// Жалобы на ролики и комментарии: приём, очередь, разбор.
//
// ЖАЛОБА НИЧЕГО НЕ СКРЫВАЕТ САМА. Никакого автоснятия по числу сигналов
// здесь нет и не будет: на медицинской площадке это готовый инструмент
// заглушить неудобный разбор — достаточно договориться десятерым. Материал
// убирает человек, своей рукой, и это отдельное действие с журналом
// (video.admin.archive). Жалоба лишь ставит материал в очередь на просмотр.
//
// ЖАЛОБА ПРИНИМАЕТСЯ ТОЛЬКО НА ОТКРЫТОЕ. Пожаловаться на приватный ролик
// нельзя: если человек его видит, он либо владелец, либо ему его показали
// адресно — это разговор, а не публикация.
//
// ОДИН ЧЕЛОВЕК — ОДНА ЖАЛОБА. Повторная отправка обновляет причину и текст,
// а не плодит записи: иначе счётчик жалоб превращается в счётчик нажатий.

import mongoose from "mongoose";
import ContentReport, { ПРИЧИНЫ } from "../models/contentReport.model.js";
import Video from "../models/video.model.js";
import {
  NotFoundError,
  ValidationError,
  ForbiddenError,
} from "../../../common/utils/errors.js";
import { recordAction, recordActionAsync } from "../../audit/services/audit.service.js";

/** Комментарий. Импорт ленивый: модель живёт вне модуля видео. */
async function Комментарий() {
  return (await import("../../../common/models/Comments/CommentDocpats.js")).default;
}

function аудитор(actor) {
  return {
    userId: actor.ownerId,
    email: actor.email || null,
    role: actor.role || (actor.ownerType === "employee" ? "employee" : null),
  };
}

/**
 * Проверить, что материал существует и открыт, и вернуть ролик, к которому
 * он относится.
 */
async function найтиМатериал({ targetType, targetId }) {
  if (!mongoose.isValidObjectId(targetId)) throw new NotFoundError("Материал не найден");

  if (targetType === "video") {
    const video = await Video.findOne({
      _id: targetId,
      visibility: "public",
      status: "ready",
      archivedAt: null,
    })
      .select("_id")
      .lean();
    if (!video) throw new NotFoundError("Ролик не найден");
    return { videoId: video._id };
  }

  const Comment = await Комментарий();
  const комментарий = await Comment.findById(targetId).select("targetId targetType").lean();
  if (!комментарий) throw new NotFoundError("Комментарий не найден");

  // Жалобы принимаем только на обсуждение под роликами: комментарии под
  // статьями и профилями врачей разбирают в своих местах, и подменять их
  // очередь этой было бы подменой ответственности.
  if (комментарий.targetType !== "Video") {
    throw new ValidationError("На этот комментарий жалуются в другом разделе");
  }

  return { videoId: комментарий.targetId };
}

/**
 * Подать жалобу.
 *
 * @param {object} p
 * @param {object} p.actor
 * @param {object} p.data { targetType, targetId, reason, note }
 */
export async function report({ actor, data }) {
  if (actor.ownerType !== "user") {
    throw new ForbiddenError("Жалобу подаёт человек, а не сотрудник клиники");
  }
  if (!ПРИЧИНЫ.includes(data.reason)) throw new ValidationError("Неизвестная причина");

  const { videoId } = await найтиМатериал(data);

  // Повторная жалоба того же человека — правка прежней. upsert, а не
  // create: иначе уникальный индекс вернул бы человеку ошибку в ответ на
  // попытку уточнить, что именно не так.
  const жалоба = await ContentReport.findOneAndUpdate(
    {
      reporterId: actor.ownerId,
      targetType: data.targetType,
      targetId: data.targetId,
    },
    {
      $set: {
        reason: data.reason,
        note: (data.note || "").trim(),
        videoId,
      },
      $setOnInsert: { status: "new" },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true },
  );

  // Журнал синхронный: жалоба — это заявление человека о нарушении, и
  // потерять его нельзя. Обычные чтения пишутся иначе.
  await recordAction({
    actor: аудитор(actor),
    action: "video.report",
    resourceType: data.targetType === "video" ? "video" : "video-comment",
    resourceId: data.targetId,
    // Текст жалобы в журнал не кладём: он написан свободной рукой и может
    // содержать что угодно, вплоть до сведений о здоровье.
    metadata: { reason: data.reason, hasNote: Boolean(data.note?.trim()) },
  });

  return жалоба;
}

/** Сколько жалоб на материал и подавал ли этот человек. */
export async function reportState({ actor, targetType, targetId }) {
  if (!mongoose.isValidObjectId(targetId)) return { reports: 0, reportedByMe: false };

  const [reports, моя] = await Promise.all([
    ContentReport.countDocuments({ targetType, targetId }),
    actor?.ownerId
      ? ContentReport.exists({ targetType, targetId, reporterId: actor.ownerId })
      : null,
  ]);

  return { reports, reportedByMe: Boolean(моя) };
}

/**
 * Очередь разбора.
 *
 * Открытые жалобы первыми, внутри — свежие сверху. Разбирающему нужен
 * список дел, а не архив.
 */
export async function listReports({ actor, query = {} }) {
  const фильтр = {};
  if (query.status) фильтр.status = query.status;
  if (query.targetType) фильтр.targetType = query.targetType;

  const limit = Math.min(Number(query.limit) || 50, 200);

  const items = await ContentReport.find(фильтр)
    .sort({ status: 1, createdAt: -1 })
    .limit(limit)
    .lean();

  // Показываем, на что жалуются: без названия ролика и текста комментария
  // список превращается в перечень идентификаторов.
  const ролики = await Video.find({
    _id: { $in: items.filter((ж) => ж.videoId).map((ж) => ж.videoId) },
  })
    .select("title visibility archivedAt")
    .lean();
  const поId = new Map(ролики.map((в) => [String(в._id), в]));

  const Comment = await Комментарий();
  const комментарии = await Comment.find({
    _id: { $in: items.filter((ж) => ж.targetType === "comment").map((ж) => ж.targetId) },
  })
    .select("content")
    .lean();
  const текстыКомментариев = new Map(комментарии.map((к) => [String(к._id), к.content]));

  recordActionAsync({
    actor: аудитор(actor),
    action: "video.report.list",
    resourceType: "video",
    resourceId: null,
    metadata: { count: items.length, status: query.status || "all" },
  });

  return {
    items: items.map((ж) => ({
      ...ж,
      video: ж.videoId ? поId.get(String(ж.videoId)) || null : null,
      commentText:
        ж.targetType === "comment" ? текстыКомментариев.get(String(ж.targetId)) || null : null,
    })),
  };
}

/**
 * Закрыть жалобу решением.
 *
 * Решение обязательно и на согласие, и на отказ: через полгода вопрос
 * «почему это оставили» задаст не тот, кто закрывал.
 */
export async function resolveReport({ actor, id, status, resolution }) {
  if (!["resolved", "rejected", "reviewing"].includes(status)) {
    throw new ValidationError("Недопустимое состояние жалобы");
  }
  if (status !== "reviewing" && !String(resolution || "").trim()) {
    throw new ValidationError("Опишите решение: почему жалоба закрыта");
  }

  const жалоба = await ContentReport.findById(id);
  if (!жалоба) throw new NotFoundError("Жалоба не найдена");

  жалоба.status = status;
  if (status === "reviewing") {
    жалоба.handledBy = actor.ownerId;
  } else {
    жалоба.resolution = String(resolution).trim();
    жалоба.handledBy = actor.ownerId;
    жалоба.handledAt = new Date();
  }
  await жалоба.save();

  await recordAction({
    actor: аудитор(actor),
    action: "video.report.resolve",
    resourceType: жалоба.targetType === "video" ? "video" : "video-comment",
    resourceId: жалоба.targetId,
    metadata: { status, reason: жалоба.reason },
  });

  return жалоба;
}

export default { report, reportState, listReports, resolveReport };
