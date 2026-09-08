// server/modules/video/services/video.service.js
//
// Правила каталога видео. Здесь живёт всё, что нельзя доверить маршруту:
// кто что видит, кому можно править и что значит «опубликовать».
//
// ПОЧЕМУ АКТЁР ПЕРЕДАЁТСЯ ЯВНО, А НЕ БЕРЁТСЯ ИЗ КОНТЕКСТА. Модуль
// глобальный: ролики снимают и вне клиники, где tenantContext пуст. Функция,
// которая молча читает контекст, в таком месте начинает вести себя по-разному
// в зависимости от того, откуда её позвали, — и хуже всего это проявляется
// в cron и воркерах, где контекста нет вовсе.
//
// НЕ НАЙДЕНО ВМЕСТО ОТКАЗАНО. Чужой приватный ролик отвечает 404, а не 403:
// иначе перебором идентификаторов можно узнать, что у такого-то врача есть
// ролик про такую-то операцию. Для владельца поведение не меняется.

import mongoose from "mongoose";
import Video from "../models/video.model.js";
import {
  NotFoundError,
  ForbiddenError,
  ValidationError,
} from "../../../common/utils/errors.js";
import { canFor } from "../../../common/auth/can.js";
import {
  recordAction,
  recordActionAsync,
} from "../../audit/services/audit.service.js";

/* ═══════════ вспомогательное ═══════════ */

const asId = (v) => (v ? String(v) : "");

/**
 * Актёр журнала.
 *
 * userId в модели журнала — обязательное поле типа ObjectId, и в него пишут
 * либо User._id, либо ClinicEmployee._id: обе сущности служат опознанием
 * действующего лица (так же делает clinic-medical). Отдать сюда null значило
 * бы, что действия сотрудников клиники не пишутся вовсе — запись не прошла бы
 * валидацию, а recordActionAsync гасит такую ошибку в warning. Тишина в
 * журнале — худший вид дефекта аудита.
 */
function auditActor(actor) {
  return {
    userId: actor.ownerId,
    email: actor.email || null,
    role: actor.role || (actor.ownerType === "employee" ? "employee" : null),
  };
}

/**
 * Право роли клиники на ресурс "video".
 *
 * canFor, а не can(): контекста может не быть вовсе, и тогда единственное
 * основание доступа — владение роликом, которое проверяется отдельно.
 */
function clinicCan(actor, action) {
  if (!actor.role || !actor.clinicId) return false;
  return canFor(
    { role: actor.role, permissions: actor.permissions || null },
    "video",
    action,
  );
}

/** Владелец ролика — тот же актёр, что его создал. */
function isOwner(video, actor) {
  return (
    video.ownerType === actor.ownerType &&
    asId(video.ownerId) === asId(actor.ownerId)
  );
}

/** Ролик клиники, в которой актёр сейчас работает. */
function sameClinic(video, actor) {
  return (
    !!video.clinicId && !!actor.clinicId &&
    asId(video.clinicId) === asId(actor.clinicId)
  );
}

/**
 * Может ли актёр СМОТРЕТЬ ролик.
 *
 * Порядок проверок — от самого сильного основания к самому слабому, чтобы
 * владелец не проваливался в правила видимости своего же ролика.
 */
export function canView(video, actor) {
  if (!video) return false;
  if (actor && isOwner(video, actor)) return true;
  if (video.visibility === "public") return true;
  if (video.visibility === "link") return true; // прямой адрес, но не список
  if (video.visibility === "clinic" && actor && sameClinic(video, actor)) {
    return clinicCan(actor, "read");
  }
  return false;
}

/**
 * Может ли актёр ПРАВИТЬ ролик.
 *
 * Ролик клиники правит и её администратор — иначе уволившийся врач унёс бы
 * с собой единственный ключ к материалам, снятым за счёт клиники.
 */
function canEdit(video, actor) {
  if (isOwner(video, actor)) return true;
  if (sameClinic(video, actor)) return clinicCan(actor, "write");
  return false;
}

function canDelete(video, actor) {
  if (isOwner(video, actor)) return true;
  if (sameClinic(video, actor)) return clinicCan(actor, "delete");
  return false;
}

/** Ролик, доступный актёру на чтение, либо 404. */
async function loadViewable(id, actor) {
  if (!mongoose.isValidObjectId(id)) throw new NotFoundError("Видео не найдено");
  const video = await Video.findById(id);
  if (!video || !canView(video, actor)) {
    throw new NotFoundError("Видео не найдено");
  }
  return video;
}

/* ═══════════ создание ═══════════ */

/**
 * Завести запись каталога.
 *
 * Файла на этот момент обычно ещё нет: студия только начинает рендер, и
 * запись существует ради того, чтобы готовому фильму было куда вернуться.
 */
export async function createVideo({ actor, data }) {
  const video = new Video({
    ownerType: actor.ownerType,
    ownerId: actor.ownerId,
    // Ролик приписывается к клинике только если человек работает в ней
    // прямо сейчас. Иначе он личный — и останется у автора при уходе.
    clinicId: actor.clinicId || null,
    title: data.title,
    description: data.description || "",
    lang: data.lang || "ru",
    kind: data.kind || "explainer",
    phi: Boolean(data.phi),
    // visibility намеренно не берётся из запроса: новый ролик всегда
    // приватный, а открытие наружу — отдельное действие publish со своими
    // проверками. Иначе «случайно публичный» ролик был бы одним полем в теле.
    visibility: "private",
    source: {
      kind: data.source?.kind || "studio",
      studioFilmId: data.source?.studioFilmId || null,
      ref: {
        entityType: data.source?.ref?.entityType || "",
        entityId: data.source?.ref?.entityId || null,
      },
    },
    attribution: data.attribution || [],
    status: "draft",
  });

  await video.save();

  await recordAction({
    actor: auditActor(actor),
    action: "video.create",
    resourceType: "video",
    resourceId: video._id,
    metadata: {
      kind: video.kind,
      phi: video.phi,
      sourceKind: video.source.kind,
      hasClinic: Boolean(video.clinicId),
    },
  });

  return video;
}

/* ═══════════ чтение ═══════════ */

/**
 * Список роликов актёра.
 *
 * Что попадает в список: свои — всегда; ролики клиники — если актёр в ней
 * работает и роль это позволяет. Ролики с visibility="link" в чужие списки
 * не попадают никогда: ссылка на то и ссылка, что её дают адресно.
 */
export async function listVideos({ actor, query = {} }) {
  const or = [{ ownerType: actor.ownerType, ownerId: actor.ownerId }];
  if (actor.clinicId && clinicCan(actor, "read")) {
    or.push({ clinicId: actor.clinicId, visibility: { $in: ["clinic", "public"] } });
  }

  const filter = { $or: or };
  if (query.kind) filter.kind = query.kind;
  if (query.status) filter.status = query.status;
  if (query.phi !== undefined) filter.phi = query.phi;

  const limit = Math.min(Number(query.limit) || 50, 200);
  const items = await Video.find(filter)
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean();

  recordActionAsync({
    actor: auditActor(actor),
    action: "video.list",
    resourceType: "video",
    metadata: { count: items.length, hasClinic: Boolean(actor.clinicId) },
  });

  return { items };
}

export async function getVideo({ actor, id }) {
  const video = await loadViewable(id, actor);

  recordActionAsync({
    actor: auditActor(actor),
    action: "video.read",
    resourceType: "video",
    resourceId: video._id,
    metadata: { phi: video.phi, visibility: video.visibility },
  });

  return video;
}

/**
 * Витрина: только опубликованное и готовое к показу.
 *
 * Отдельная функция, а не listVideos с флагом: у витрины нет актёра, и
 * общий код рано или поздно получил бы условие «если актёра нет, то…» —
 * ровно ту развилку, через которую приватный ролик и утекает наружу.
 */
export async function listPublicVideos({ query = {} } = {}) {
  const filter = { visibility: "public", status: "ready", phi: false };
  if (query.kind) filter.kind = query.kind;
  if (query.lang) filter.lang = query.lang;

  const limit = Math.min(Number(query.limit) || 24, 100);
  const items = await Video.find(filter)
    .sort({ publishedAt: -1 })
    .limit(limit)
    .select("title description lang kind media.posterKey media.durationSec attribution publishedAt stats")
    .lean();

  return { items };
}

/**
 * Один публичный ролик — для витрины и для страницы, которую увидит
 * поисковик. Без сессии: витрина на то и витрина.
 *
 * Отдаём тот же набор полей, что и список, плюс атрибуцию: строка лицензии
 * обязана быть на странице, иначе использование материалов под CC —
 * нарушение, сколько бы аккуратно она ни была вписана в кадр.
 */
export async function getPublicVideo({ id }) {
  if (!mongoose.isValidObjectId(id)) throw new NotFoundError("Видео не найдено");
  const video = await Video.findOne({
    _id: id,
    visibility: "public",
    status: "ready",
    phi: false,
  })
    .select(
      "title description lang kind media.posterKey media.durationSec attribution publishedAt stats clinicId",
    )
    .lean();

  if (!video) throw new NotFoundError("Видео не найдено");
  return video;
}

/**
 * Публичные ролики клиники — её канал на витрине.
 *
 * Отдельно от общей витрины: клиника показывает свою ленту на своей
 * странице, и подмешивать туда чужие ролики нельзя.
 */
export async function listClinicPublicVideos({ clinicId, limit = 24 }) {
  if (!mongoose.isValidObjectId(clinicId)) return { items: [] };
  const items = await Video.find({
    clinicId,
    visibility: "public",
    status: "ready",
    phi: false,
  })
    .sort({ publishedAt: -1 })
    .limit(Math.min(Number(limit) || 24, 100))
    .select("title description lang kind media.posterKey media.durationSec publishedAt stats")
    .lean();
  return { items };
}

/* ═══════════ правка ═══════════ */

const EDITABLE = ["title", "description", "lang", "kind", "phi", "attribution"];

export async function updateVideo({ actor, id, patch }) {
  const video = await loadViewable(id, actor);
  if (!canEdit(video, actor)) throw new ForbiddenError("Нельзя править чужой ролик");

  for (const field of EDITABLE) {
    if (patch[field] !== undefined) video[field] = patch[field];
  }

  // Ролик пометили как PHI, а он уже открыт — закрываем немедленно.
  // Иначе pre-validate отказал бы в сохранении, и правка «это всё-таки
  // пациент» стала бы невозможной именно тогда, когда она срочнее всего.
  if (video.phi && ["public", "link"].includes(video.visibility)) {
    video.visibility = "private";
    video.publishedAt = null;
    video.publishedBy = null;
  }

  await video.save();

  await recordAction({
    actor: auditActor(actor),
    action: "video.update",
    resourceType: "video",
    resourceId: video._id,
    metadata: { fields: Object.keys(patch), phi: video.phi },
  });

  return video;
}

/**
 * Поставить файлы удаляемого ролика в очередь уборки R2.
 *
 * Не удаляем синхронно намеренно — тем же рассуждением, что и в
 * clinic-medical/imaging: если хранилище недоступно, человек не должен
 * получать ошибку на удалении своей же записи, а файл не должен остаться
 * незамеченным. Очередь даёт повтор и видимость.
 *
 * Сбой постановки в очередь не срывает удаление: потерять уборку файла
 * неприятно, но оставить пользователю неудаляемый ролик — хуже.
 */
async function поставитьФайлыВОчередьУборки(video) {
  const base = process.env.R2_PUBLIC_URL;
  if (!base) return; // хранилище не настроено — убирать нечего

  const ключи = [
    video.media?.storageKey,
    video.media?.hlsKey,
    video.media?.posterKey,
    ...(video.locales || []).flatMap((l) => [l.subtitleKey, l.audioKey]),
  ].filter(Boolean);

  if (!ключи.length) return;

  try {
    const OrphanR2File = (
      await import("../../../common/models/system/OrphanR2File.js")
    ).default;
    await OrphanR2File.insertMany(
      ключи.map((key) => ({
        fileUrl: `${base}/${key}`,
        sourceModel: "Video",
        sourceId: video._id,
        clinicId: video.clinicId || null,
      })),
      { ordered: false },
    );
  } catch (err) {
    console.warn("[video] не удалось поставить файлы в очередь уборки:", err?.message);
  }
}

export async function deleteVideo({ actor, id }) {
  const video = await loadViewable(id, actor);
  if (!canDelete(video, actor)) throw new ForbiddenError("Нельзя удалить чужой ролик");

  const snapshot = {
    kind: video.kind,
    phi: video.phi,
    visibility: video.visibility,
    hadFile: Boolean(video.media?.storageKey),
  };

  // Файлы — в очередь уборки ДО удаления записи: после неё ключи взять
  // неоткуда, и файл остался бы в хранилище навсегда, платно и незаметно.
  await поставитьФайлыВОчередьУборки(video);

  await Video.deleteOne({ _id: video._id });

  await recordAction({
    actor: auditActor(actor),
    action: "video.delete",
    resourceType: "video",
    resourceId: video._id,
    metadata: snapshot,
  });

  // Файл в R2 переживёт запись: его подберёт уборщик сирот. Удалять здесь
  // значило бы потерять файл при откате транзакции, которой тут нет.
  return { deleted: true };
}

/* ═══════════ публикация ═══════════ */

/**
 * Открыть ролик шире круга владельца.
 *
 * Три отказа, и ни один из них не про роль:
 *   • ролик с пациентом в кадре не публикуется вообще;
 *   • нечего показывать, пока файл не готов;
 *   • "clinic" без клиники — видимость, которую никто не увидит.
 */
export async function publishVideo({ actor, id, visibility }) {
  const video = await loadViewable(id, actor);
  if (!canEdit(video, actor)) throw new ForbiddenError("Нельзя публиковать чужой ролик");

  if (!["clinic", "link", "public"].includes(visibility)) {
    throw new ValidationError("Недопустимая видимость для публикации");
  }
  if (video.phi) {
    throw new ForbiddenError(
      "В ролике есть пациент — публикация запрещена. Снимите отметку PHI, если это не так.",
    );
  }
  if (video.status !== "ready") {
    throw new ValidationError("Ролик ещё не готов: файла нет");
  }
  if (visibility === "clinic" && !video.clinicId) {
    throw new ValidationError("Ролик не привязан к клинике");
  }

  video.visibility = visibility;
  video.publishedAt = new Date();
  video.publishedBy = actor.ownerId;
  await video.save();

  await recordAction({
    actor: auditActor(actor),
    action: "video.publish",
    resourceType: "video",
    resourceId: video._id,
    metadata: {
      visibility,
      kind: video.kind,
      licenses: (video.attribution || []).map((a) => a.license),
    },
  });

  return video;
}

export async function unpublishVideo({ actor, id }) {
  const video = await loadViewable(id, actor);
  if (!canEdit(video, actor)) throw new ForbiddenError("Нельзя снять чужой ролик");

  video.visibility = "private";
  video.publishedAt = null;
  video.publishedBy = null;
  await video.save();

  await recordAction({
    actor: auditActor(actor),
    action: "video.unpublish",
    resourceType: "video",
    resourceId: video._id,
    metadata: { kind: video.kind },
  });

  return video;
}

/* ═══════════ привязка к сущностям ═══════════ */

/**
 * Прикрепить ролик к приёму, карте, случаю.
 *
 * Повторная привязка к той же сущности — не ошибка, а ничего: врач,
 * нажавший дважды, не должен получать красное окно.
 */
export async function attachVideo({ actor, id, entityType, entityId }) {
  const video = await loadViewable(id, actor);
  if (!canEdit(video, actor)) throw new ForbiddenError("Нельзя менять чужой ролик");

  const already = (video.attachments || []).some(
    (a) => a.entityType === entityType && asId(a.entityId) === asId(entityId),
  );
  if (!already) {
    video.attachments.push({
      entityType,
      entityId,
      byMembershipId: actor.membershipId || null,
    });
    await video.save();

    await recordAction({
      actor: auditActor(actor),
      action: "video.attach",
      resourceType: "video",
      resourceId: video._id,
      metadata: { entityType, attachments: video.attachments.length },
    });
  }

  return video;
}

export async function detachVideo({ actor, id, entityType, entityId }) {
  const video = await loadViewable(id, actor);
  if (!canEdit(video, actor)) throw new ForbiddenError("Нельзя менять чужой ролик");

  const before = video.attachments.length;
  video.attachments = video.attachments.filter(
    (a) => !(a.entityType === entityType && asId(a.entityId) === asId(entityId)),
  );
  if (video.attachments.length !== before) {
    await video.save();
    await recordAction({
      actor: auditActor(actor),
      action: "video.detach",
      resourceType: "video",
      resourceId: video._id,
      metadata: { entityType, attachments: video.attachments.length },
    });
  }

  return video;
}

/**
 * Ролики, прикреплённые к сущности — «что показывали на этом приёме».
 * Фильтрация по доступу та же, что и везде: список просеивается canView.
 */
export async function listVideosForEntity({ actor, entityType, entityId }) {
  if (!mongoose.isValidObjectId(entityId)) return { items: [] };
  const found = await Video.find({
    attachments: { $elemMatch: { entityType, entityId } },
  }).sort({ createdAt: -1 });

  return { items: found.filter((v) => canView(v, actor)) };
}

/* ═══════════ приём рендера из студии ═══════════ */

/**
 * Студия закончила рендер и сообщает, где лежит файл.
 *
 * Вызывается вебхуком, у которого нет ни сессии, ни актёра, — поэтому
 * функция не проверяет прав: её единственный ключ доступа проверен
 * подписью на уровне маршрута. Здесь же — идемпотентность: студия
 * повторяет доставку, и второй вызов не должен ничего ломать.
 */
export async function applyStudioRender({ studioFilmId, media, status, failureReason }) {
  if (!studioFilmId) throw new ValidationError("Не указан studioFilmId");

  const video = await Video.findOne({ "source.studioFilmId": studioFilmId });
  if (!video) throw new NotFoundError("Запись каталога для этого фильма не найдена");

  if (status === "failed") {
    video.status = "failed";
    video.failureReason = String(failureReason || "").slice(0, 500);
  } else {
    video.media.storageKey = media?.storageKey || video.media.storageKey;
    video.media.hlsKey = media?.hlsKey || video.media.hlsKey;
    video.media.posterKey = media?.posterKey || video.media.posterKey;
    video.media.durationSec = Number(media?.durationSec) || video.media.durationSec;
    video.media.sizeBytes = Number(media?.sizeBytes) || video.media.sizeBytes;
    if (media?.mime) video.media.mime = media.mime;
    video.status = video.media.storageKey || video.media.hlsKey ? "ready" : "processing";
    video.failureReason = "";
  }

  await video.save();

  // Действие совершила служба, а не человек. Поле userId обязательное, и
  // строка "system" в него не пишется (тип ObjectId — запись потерялась бы
  // молча), поэтому опознаём событие владельцем ролика, а машинность
  // фиксируем ролью: в журнале это читается как «с роликом такого-то
  // произошло системное событие», а не как его поступок.
  recordActionAsync({
    actor: { userId: video.ownerId, email: null, role: "system" },
    action: "video.studio_callback",
    resourceType: "video",
    resourceId: video._id,
    metadata: {
      status: video.status,
      durationSec: video.media.durationSec,
      hasPoster: Boolean(video.media.posterKey),
    },
  });

  // СУБТИТРЫ СОБИРАЕМ ПОСЛЕ ОТВЕТА, А НЕ ВНУТРИ НЕГО.
  //
  // Перевод на четыре языка — четыре обращения к модели, десятки секунд.
  // Студия ждёт ответа на свой вебхук и по таймауту повторит доставку, а
  // повторная доставка запустила бы перевод второй раз и оплатила его
  // дважды. Поэтому дорожки собираются отдельно от ответа; их отсутствие
  // ничего не ломает — ролик играет и без субтитров.
  if (video.status === "ready" && video.generation?.script) {
    import("../render/subtitles.js")
      .then(({ attachSubtitles }) => attachSubtitles(video))
      .then(({ added }) => {
        if (added.length) console.log(`[video] субтитры готовы: ${added.join(", ")}`);
      })
      .catch((err) => console.warn("[video] субтитры не собрались:", err?.message));
  }

  return video;
}

export default {
  createVideo,
  listVideos,
  listPublicVideos,
  getPublicVideo,
  listClinicPublicVideos,
  getVideo,
  updateVideo,
  deleteVideo,
  publishVideo,
  unpublishVideo,
  attachVideo,
  detachVideo,
  listVideosForEntity,
  applyStudioRender,
  setIntroVideo,
  clearIntroVideo,
  canView,
};

/* ═══════════ видео-визитка врача ═══════════ */

/**
 * Поставить ролик визиткой в свой профиль.
 *
 * Три отказа, и все по существу:
 *   • чужой ролик визиткой не сделаешь;
 *   • визитка с пациентом в кадре — утечка на публичной странице;
 *   • закрытый ролик посетитель профиля всё равно не откроет, и визитка
 *     выглядела бы как сломанная картинка.
 *
 * Живёт здесь, а не в модуле профилей: все три правила — про ролик, и знать
 * их должен тот, кто про ролики и отвечает.
 */
export async function setIntroVideo({ actor, id }) {
  const video = await loadViewable(id, actor);
  if (!isOwner(video, actor)) {
    throw new ForbiddenError("Визиткой можно сделать только свой ролик");
  }
  if (video.phi) {
    throw new ForbiddenError("В ролике есть пациент — он не может быть визиткой");
  }
  if (video.status !== "ready") {
    throw new ValidationError("Ролик ещё не готов");
  }
  if (!["link", "public"].includes(video.visibility)) {
    throw new ValidationError(
      "Сначала откройте ролик по ссылке или опубликуйте — иначе посетитель профиля его не увидит",
    );
  }

  const DoctorProfile = (
    await import("../../../common/models/DoctorProfile/profileDoctor.js")
  ).default;
  const профиль = await DoctorProfile.findOneAndUpdate(
    { userId: actor.ownerId },
    { introVideoId: video._id },
    { new: true },
  );
  if (!профиль) throw new NotFoundError("Профиль врача не найден");

  await recordAction({
    actor: auditActor(actor),
    action: "video.update",
    resourceType: "video",
    resourceId: video._id,
    metadata: { intro: true, visibility: video.visibility },
  });

  return { introVideoId: video._id };
}

/** Снять визитку. Отдельное действие: врач вправе остаться без неё. */
export async function clearIntroVideo({ actor }) {
  const DoctorProfile = (
    await import("../../../common/models/DoctorProfile/profileDoctor.js")
  ).default;
  await DoctorProfile.findOneAndUpdate(
    { userId: actor.ownerId },
    { introVideoId: null },
  );
  return { introVideoId: null };
}
