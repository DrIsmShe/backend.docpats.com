// server/modules/video/services/videoAdmin.service.js
//
// Управление каталогом от лица администратора платформы.
//
// ЧЕМ ЭТО ОТЛИЧАЕТСЯ ОТ ОБЫЧНЫХ ДЕЙСТВИЙ. Владелец распоряжается своим
// роликом; администратор — любым, включая чужие. Поэтому здесь отдельный
// сервис, отдельные события журнала (video.admin.*) и обязательная причина
// у архивации и удаления: «кто убрал чужой материал и почему» — первый
// вопрос, который зададут, и ответ на него должен быть в базе, а не в
// чьей-то памяти.
//
// ПРАВА НЕ ПРОВЕРЯЮТСЯ ЗДЕСЬ. Их проверяет requireAdmin на маршруте: он
// ходит в базу за пользователем и сверяет role === "admin". Дублировать
// проверку в сервисе значило бы иметь два места, где это правило может
// разъехаться.
//
// АРХИВ ВМЕСТО УДАЛЕНИЯ. Удаление необратимо и уносит файл; архив прячет
// ролик из витрины и списков, оставляя запись. Для чужого материала это
// почти всегда правильный выбор — ошибку модерации можно отменить.

import mongoose from "mongoose";
import Video from "../models/video.model.js";
import { NotFoundError, ValidationError } from "../../../common/utils/errors.js";
import { recordAction } from "../../audit/services/audit.service.js";

const МАКС_СПИСОК = 200;

function actor(adminId) {
  return { userId: adminId, email: null, role: "admin" };
}

async function найти(id) {
  if (!mongoose.isValidObjectId(id)) throw new NotFoundError("Видео не найдено");
  const video = await Video.findById(id);
  if (!video) throw new NotFoundError("Видео не найдено");
  return video;
}

/**
 * Все ролики каталога — включая чужие, черновики и архив.
 *
 * Обычный список показывает человеку своё; этот показывает всё, потому что
 * модерировать можно только то, что видно.
 */
export async function adminList({ adminId, query = {} }) {
  const filter = {};
  if (query.status) filter.status = query.status;
  if (query.visibility) filter.visibility = query.visibility;
  if (query.phi !== undefined) filter.phi = query.phi;
  // По умолчанию архив скрыт: он и заводился, чтобы не мешать.
  if (query.archived === true) filter.archivedAt = { $ne: null };
  else if (query.archived !== "all") filter.archivedAt = null;

  if (query.q) {
    // Поиск по названию — по регулярному выражению с экранированием:
    // строка приходит от человека и не должна становиться шаблоном.
    const безопасно = String(query.q).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    filter.title = { $regex: безопасно, $options: "i" };
  }

  const limit = Math.min(Number(query.limit) || 50, МАКС_СПИСОК);
  const items = await Video.find(filter)
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  recordAction({
    actor: actor(adminId),
    action: "video.admin.list",
    resourceType: "video",
    metadata: { count: items.length, archived: Boolean(query.archived) },
  }).catch(() => {});

  return { items };
}

/** Один ролик целиком — админу видно всё, включая сценарий и проверку. */
export async function adminGet({ adminId, id }) {
  const video = await найти(id);
  return video;
}

/**
 * Правка любого ролика.
 *
 * Видимость здесь менять МОЖНО, в отличие от обычной правки: администратор
 * снимает материал с витрины именно тем, что закрывает его, и заставлять
 * его для этого пользоваться публикацией от чужого имени бессмысленно.
 * Но ролик с пациентом в кадре не откроется всё равно — это правило модели.
 */
const ПОЛЯ = [
  "title",
  "description",
  "lang",
  "kind",
  "phi",
  "visibility",
  "attribution",
  "categoryId",
];

export async function adminUpdate({ adminId, id, patch }) {
  const video = await найти(id);

  for (const поле of ПОЛЯ) {
    if (patch[поле] !== undefined) video[поле] = patch[поле];
  }
  if (video.phi && ["public", "link"].includes(video.visibility)) {
    video.visibility = "private";
    video.publishedAt = null;
  }
  if (video.visibility === "public" && !video.publishedAt) {
    video.publishedAt = new Date();
  }
  await video.save();

  await recordAction({
    actor: actor(adminId),
    action: "video.admin.update",
    resourceType: "video",
    resourceId: video._id,
    resourceOwnerId: video.ownerType === "user" ? video.ownerId : null,
    metadata: { fields: Object.keys(patch), visibility: video.visibility },
  });

  return video;
}

/**
 * Убрать из показа, не удаляя.
 *
 * Видимость сбрасывается в private вместе с отметкой архива: иначе ролик
 * остался бы «опубликованным, но скрытым» — состояние, которое рано или
 * поздно кто-нибудь покажет обратно, не зная, что его убирали.
 */
export async function adminArchive({ adminId, id, reason }) {
  const video = await найти(id);
  if (video.archivedAt) throw new ValidationError("Ролик уже в архиве");
  if (!String(reason || "").trim()) {
    throw new ValidationError("Укажите причину — это чужой материал");
  }

  video.archivedAt = new Date();
  video.archivedBy = adminId;
  video.archiveReason = String(reason).slice(0, 500);
  video.visibility = "private";
  video.publishedAt = null;
  await video.save();

  await recordAction({
    actor: actor(adminId),
    action: "video.admin.archive",
    resourceType: "video",
    resourceId: video._id,
    resourceOwnerId: video.ownerType === "user" ? video.ownerId : null,
    // Причина в журнал не копируется: это свободный текст, где может
    // оказаться что угодно. В базе она есть, в журнале — факт её наличия.
    metadata: { hasReason: true, wasVisible: true },
  });

  return video;
}

/** Вернуть из архива. Видимость не восстанавливаем — её выбирают заново. */
export async function adminUnarchive({ adminId, id }) {
  const video = await найти(id);
  if (!video.archivedAt) throw new ValidationError("Ролик не в архиве");

  video.archivedAt = null;
  video.archivedBy = null;
  video.archiveReason = "";
  await video.save();

  await recordAction({
    actor: actor(adminId),
    action: "video.admin.unarchive",
    resourceType: "video",
    resourceId: video._id,
    resourceOwnerId: video.ownerType === "user" ? video.ownerId : null,
    metadata: { visibility: video.visibility },
  });

  return video;
}

/**
 * Удалить любой ролик.
 *
 * Файлы уходят в очередь уборки до удаления записи — после неё ключи взять
 * неоткуда. Причина обязательна по той же причине, что и в архиве.
 */
export async function adminDelete({ adminId, id, reason }) {
  const video = await найти(id);
  if (!String(reason || "").trim()) {
    throw new ValidationError("Укажите причину удаления");
  }

  const снимок = {
    kind: video.kind,
    phi: video.phi,
    visibility: video.visibility,
    wasArchived: Boolean(video.archivedAt),
    hadFile: Boolean(video.media?.storageKey),
  };

  // Файлы — в очередь уборки ДО удаления записи: после неё ключи взять
  // неоткуда, и они остались бы в хранилище навсегда.
  const { enqueueOrphanFiles } = await import("./video.service.js");
  await enqueueOrphanFiles(video);

  await Video.deleteOne({ _id: video._id });

  await recordAction({
    actor: actor(adminId),
    action: "video.admin.delete",
    resourceType: "video",
    resourceId: video._id,
    resourceOwnerId: video.ownerType === "user" ? video.ownerId : null,
    metadata: { ...снимок, hasReason: true },
  });

  return { deleted: true };
}

export default {
  adminList,
  adminGet,
  adminUpdate,
  adminArchive,
  adminUnarchive,
  adminDelete,
};
