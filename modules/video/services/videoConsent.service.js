// server/modules/video/services/videoConsent.service.js
//
// Жизненный путь видео-согласия: запросили → пациент досмотрел → подписал.
//
// КТО ЧТО МОЖЕТ. Запрашивает согласие клиника (право video.write), подписывает
// ТОЛЬКО сам пациент из своего кабинета. Разделение принципиальное: согласие,
// которое врач может проставить за пациента, юридически ничего не стоит, и
// весь смысл конструкции пропадает.
//
// ПРОГРЕСС НЕ ПРИХОДИТ ИЗ ЗАПРОСА. Отметку «досмотрел» ставит только
// registerWatch, вызываемый из учёта просмотра, — её нельзя выставить
// обращением к API. Иначе подпись без просмотра делалась бы одним запросом.

import mongoose from "mongoose";
import VideoConsent from "../models/videoConsent.model.js";
import Video from "../models/video.model.js";
import {
  NotFoundError,
  ForbiddenError,
  ValidationError,
  ConflictError,
} from "../../../common/utils/errors.js";
import { canFor } from "../../../common/auth/can.js";
import { recordAction } from "../../audit/services/audit.service.js";
import { deliverConsentRequest } from "./patientDelivery.service.js";

/** Сколько живёт запрос согласия, если срок не задан явно. */
const СРОК_ПО_УМОЛЧАНИЮ_ДНЕЙ = 30;

const asId = (v) => (v ? String(v) : "");

function auditActor(actor) {
  return {
    userId: actor.ownerId,
    email: actor.email || null,
    role: actor.role || (actor.ownerType === "employee" ? "employee" : null),
  };
}

function clinicCan(actor, action) {
  if (!actor.role || !actor.clinicId) return false;
  return canFor(
    { role: actor.role, permissions: actor.permissions || null },
    "video",
    action,
  );
}

/** Согласие активно, если не отозвано и не просрочено. */
function просрочено(consent) {
  return (
    consent.status !== "signed" &&
    consent.expiresAt &&
    consent.expiresAt.getTime() < Date.now()
  );
}

/* ═══════════ запрос согласия ═══════════ */

/**
 * Клиника требует согласия: «посмотрите объяснение и подпишите».
 *
 * Ролик обязан быть готов — просить человека посмотреть то, чего нет,
 * бессмысленно, а согласие с несуществующим приложением не доказывает
 * ничего. Снимок ролика делается здесь же: он и есть предмет согласия.
 */
export async function requestConsent({ actor, data }) {
  if (!clinicCan(actor, "write")) {
    throw new ForbiddenError("Нет права запрашивать согласие");
  }

  const video = await Video.findById(data.videoId);
  if (!video) throw new NotFoundError("Ролик не найден");
  if (video.status !== "ready") {
    throw new ValidationError("Ролик ещё не готов — показывать нечего");
  }
  if (!video.media?.durationSec) {
    throw new ValidationError(
      "У ролика неизвестна длительность — досмотр будет не с чем сравнить",
    );
  }

  const срок =
    data.expiresInDays === undefined
      ? СРОК_ПО_УМОЛЧАНИЮ_ДНЕЙ
      : Number(data.expiresInDays);

  const consent = await VideoConsent.create({
    clinicId: actor.clinicId,
    clinicPatientId: data.clinicPatientId,
    patientUserId: data.patientUserId,
    appointmentId: data.appointmentId || null,
    procedureName: data.procedureName,
    video: {
      videoId: video._id,
      title: video.title,
      durationSec: video.media.durationSec,
      lang: video.lang,
      storageKey: video.media.storageKey || video.media.hlsKey || "",
      videoUpdatedAt: video.updatedAt,
    },
    requestedByMembershipId: actor.membershipId || null,
    expiresAt: срок > 0 ? new Date(Date.now() + срок * 86400000) : null,
  });

  await recordAction({
    actor: auditActor(actor),
    action: "video.consent.request",
    resourceType: "video-consent",
    resourceId: consent._id,
    resourceOwnerId: consent.patientUserId,
    metadata: {
      videoId: String(video._id),
      durationSec: video.media.durationSec,
      hasAppointment: Boolean(consent.appointmentId),
      expiresInDays: срок,
    },
  });

  // Пациенту надо сообщить — иначе согласие лежит в кабинете, о котором он
  // не знает, а процедуру откладывают в день приёма. Уходит двумя каналами:
  // колокольчик и личный чат с врачом (см. patientDelivery.service.js).
  // Сбой доставки не отменяет запрос: он уже создан и виден в кабинете.
  await deliverConsentRequest({
    consent,
    // Сообщение в чат пишется от человека, а не от «клиники»: у сотрудника
    // без своего User диалога нет, и тогда остаётся один колокольчик.
    fromUserId: actor.ownerType === "user" ? actor.ownerId : null,
    durationSec: video.media.durationSec,
  });

  return consent;
}

/* ═══════════ просмотр ═══════════ */

/**
 * Отметить продвижение по ролику.
 *
 * Вызывается из учёта просмотра, а не из маршрута: единственный способ
 * получить отметку «досмотрел» — действительно досмотреть. Обновляются все
 * ожидающие согласия этого пациента на этот ролик: их может быть несколько,
 * если объяснение относится к двум разным вмешательствам.
 *
 * Ошибки наружу не отдаём: сбой в обновлении согласия не должен ломать
 * просмотр — но и не должен пройти незамеченным, поэтому пишем в журнал
 * ровно те согласия, что действительно закрылись.
 */
export async function registerWatch({ patientUserId, videoId, watchedSec, ratio, completed }) {
  if (!patientUserId || !videoId) return { updated: 0 };

  const ожидающие = await VideoConsent.find({
    patientUserId,
    "video.videoId": videoId,
    status: { $in: ["pending", "watched"] },
  });

  let закрыто = 0;
  for (const consent of ожидающие) {
    if (просрочено(consent)) {
      consent.status = "expired";
      await consent.save();
      continue;
    }

    consent.watch.attempts += 1;
    consent.watch.watchedSec = Math.max(consent.watch.watchedSec, watchedSec);
    consent.watch.ratio = Math.max(consent.watch.ratio, Math.min(ratio, 1));
    if (!consent.watch.firstWatchAt) consent.watch.firstWatchAt = new Date();

    // Досмотр фиксируется ОДИН раз: повторные просмотры не должны сдвигать
    // время, на которое потом будут ссылаться в споре.
    if (completed && !consent.watch.completedAt) {
      consent.watch.completedAt = new Date();
      consent.status = "watched";
      закрыто += 1;
    }
    await consent.save();

    if (completed && consent.status === "watched" && закрыто) {
      await recordAction({
        actor: { userId: patientUserId, email: null, role: "patient" },
        action: "video.consent.watched",
        resourceType: "video-consent",
        resourceId: consent._id,
        resourceOwnerId: patientUserId,
        metadata: {
          watchedSec: Math.round(consent.watch.watchedSec),
          durationSec: consent.video.durationSec,
          attempts: consent.watch.attempts,
        },
      });
    }
  }

  return { updated: ожидающие.length, completed: закрыто };
}

/* ═══════════ подпись ═══════════ */

/**
 * Пациент подписывает согласие.
 *
 * Четыре отказа, и все — по существу, а не по роли:
 *   • подписать может только тот, кому объясняли;
 *   • нельзя подписать недосмотренное;
 *   • нельзя подписать дважды;
 *   • нельзя подписать просроченное.
 */
export async function signConsent({ actor, id }) {
  if (!mongoose.isValidObjectId(id)) throw new NotFoundError("Согласие не найдено");
  const consent = await VideoConsent.findById(id);
  if (!consent) throw new NotFoundError("Согласие не найдено");

  if (asId(consent.patientUserId) !== asId(actor.ownerId) || actor.ownerType !== "user") {
    // Не 403 с объяснением, а 404: чужое согласие не должно даже
    // подтверждать своё существование.
    throw new NotFoundError("Согласие не найдено");
  }
  if (consent.status === "signed") {
    throw new ConflictError("Согласие уже подписано");
  }
  if (consent.status === "revoked") {
    throw new ConflictError("Согласие отозвано — нужен новый запрос");
  }
  if (просрочено(consent)) {
    consent.status = "expired";
    await consent.save();
    throw new ValidationError("Срок согласия истёк — попросите клинику повторить запрос");
  }
  if (!consent.watch?.completedAt) {
    throw new ValidationError("Сначала посмотрите ролик до конца");
  }

  consent.signedAt = new Date();
  consent.status = "signed";
  await consent.save();

  await recordAction({
    actor: auditActor(actor),
    action: "video.consent.sign",
    resourceType: "video-consent",
    resourceId: consent._id,
    resourceOwnerId: consent.patientUserId,
    metadata: {
      videoId: String(consent.video.videoId),
      // Сколько прошло от досмотра до подписи: в разборе спора это
      // отвечает на вопрос «подписал ли он не глядя».
      secondsFromWatchToSign: Math.round(
        (consent.signedAt - consent.watch.completedAt) / 1000,
      ),
      watchedRatio: consent.watch.ratio,
      method: consent.signatureMethod,
    },
  });

  return consent;
}

/** Отзыв. Право пациента, не клиники. */
export async function revokeConsent({ actor, id, reason }) {
  const consent = await VideoConsent.findById(id);
  if (!consent) throw new NotFoundError("Согласие не найдено");
  if (asId(consent.patientUserId) !== asId(actor.ownerId) || actor.ownerType !== "user") {
    throw new NotFoundError("Согласие не найдено");
  }
  if (consent.status !== "signed") {
    throw new ValidationError("Отозвать можно только подписанное согласие");
  }

  consent.revokedAt = new Date();
  consent.revokedReason = String(reason || "").slice(0, 500);
  consent.status = "revoked";
  await consent.save();

  await recordAction({
    actor: auditActor(actor),
    action: "video.consent.revoke",
    resourceType: "video-consent",
    resourceId: consent._id,
    resourceOwnerId: consent.patientUserId,
    metadata: {
      // Причина — свободный текст пациента, в журнал не копируется: там
      // может оказаться что угодно, вплоть до жалобы с диагнозом.
      hasReason: Boolean(consent.revokedReason),
      daysSigned: Math.round((consent.revokedAt - consent.signedAt) / 86400000),
    },
  });

  return consent;
}

/* ═══════════ чтение ═══════════ */

/** Согласия пациента — для его кабинета. */
export async function listMyConsents({ actor, status }) {
  const filter = { patientUserId: actor.ownerId };
  if (status) filter.status = status;
  const items = await VideoConsent.find(filter).sort({ createdAt: -1 }).limit(100);
  return { items };
}

/** Согласия по пациенту клиники — для карты. */
export async function listPatientConsents({ actor, clinicPatientId }) {
  if (!clinicCan(actor, "read")) throw new ForbiddenError("Нет доступа");
  const items = await VideoConsent.find({
    clinicId: actor.clinicId,
    clinicPatientId,
  })
    .sort({ createdAt: -1 })
    .limit(100);
  return { items };
}

/** Одно согласие. Видят пациент и клиника, которая его запросила. */
export async function getConsent({ actor, id }) {
  if (!mongoose.isValidObjectId(id)) throw new NotFoundError("Согласие не найдено");
  const consent = await VideoConsent.findById(id);
  if (!consent) throw new NotFoundError("Согласие не найдено");

  const свой = asId(consent.patientUserId) === asId(actor.ownerId);
  const своя = asId(consent.clinicId) === asId(actor.clinicId) && clinicCan(actor, "read");
  if (!свой && !своя) throw new NotFoundError("Согласие не найдено");

  return consent;
}

export default {
  requestConsent,
  registerWatch,
  signConsent,
  revokeConsent,
  listMyConsents,
  listPatientConsents,
  getConsent,
};
