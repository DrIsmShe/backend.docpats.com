// server/modules/video/services/videoPlaylist.service.js
//
// Планы подготовки: настройка шаблона клиникой и выдача его пациенту.
//
// ЧТО ЗДЕСЬ ГЛАВНОЕ. Не список роликов, а два числа, которые увидит врач
// перед процедурой: сколько обязательных объяснений человек посмотрел из
// скольких. По ним решают, готов пациент или процедуру придётся отменить.
//
// ПРОГРЕСС, КАК И В СОГЛАСИИ, СТАВИТ ТОЛЬКО УЧЁТ ПРОСМОТРА. Отметить шаг
// сделанным запросом к API нельзя: иначе «пациент подготовлен» стало бы
// утверждением о нажатой кнопке, а не о просмотренном ролике.

import mongoose from "mongoose";
import {
  VideoPlaylist,
  VideoPlaylistAssignment,
} from "../models/videoPlaylist.model.js";
import Video from "../models/video.model.js";
import {
  NotFoundError,
  ForbiddenError,
  ValidationError,
} from "../../../common/utils/errors.js";
import { canFor } from "../../../common/auth/can.js";
import { deliverPlaylistAssignment } from "./patientDelivery.service.js";

const asId = (v) => (v ? String(v) : "");

function clinicCan(actor, action) {
  if (!actor.role || !actor.clinicId) return false;
  return canFor(
    { role: actor.role, permissions: actor.permissions || null },
    "video",
    action,
  );
}

/* ═══════════ шаблоны ═══════════ */

export async function createPlaylist({ actor, data }) {
  if (!clinicCan(actor, "write")) throw new ForbiddenError("Нет права создавать план");

  // Все ролики должны существовать и быть готовыми: план из недоснятых
  // роликов выдать можно, а выполнить — нет.
  const ids = data.steps.map((ш) => ш.videoId);
  const найдено = await Video.find({ _id: { $in: ids }, status: "ready" }).select("_id");
  if (найдено.length !== new Set(ids.map(String)).size) {
    throw new ValidationError("Не все ролики плана существуют и готовы к показу");
  }

  return VideoPlaylist.create({
    clinicId: actor.clinicId,
    title: data.title,
    procedureName: data.procedureName,
    description: data.description || "",
    steps: data.steps,
    createdByMembershipId: actor.membershipId || null,
  });
}

export async function listPlaylists({ actor }) {
  if (!clinicCan(actor, "read")) throw new ForbiddenError("Нет доступа");
  const items = await VideoPlaylist.find({ clinicId: actor.clinicId, active: true })
    .sort({ createdAt: -1 })
    .limit(100);
  return { items };
}

export async function deactivatePlaylist({ actor, id }) {
  if (!clinicCan(actor, "write")) throw new ForbiddenError("Нет права менять план");
  const plan = await VideoPlaylist.findOne({ _id: id, clinicId: actor.clinicId });
  if (!plan) throw new NotFoundError("План не найден");
  plan.active = false;
  await plan.save();
  // Уже выданные назначения остаются в силе: человек готовится по тому,
  // что ему сказали, а не по тому, что клиника решила потом.
  return plan;
}

/* ═══════════ назначение ═══════════ */

/**
 * Выдать пациенту план подготовки к его процедуре.
 *
 * Сроки считаются от даты процедуры, а шаги копируются снимком: правка
 * шаблона задним числом не должна менять то, что человеку уже велели.
 */
export async function assignPlaylist({ actor, data }) {
  if (!clinicCan(actor, "write")) throw new ForbiddenError("Нет права назначать план");

  const plan = await VideoPlaylist.findOne({
    _id: data.playlistId,
    clinicId: actor.clinicId,
  });
  if (!plan) throw new NotFoundError("План не найден");

  const процедура = new Date(data.procedureAt);
  if (Number.isNaN(процедура.getTime())) {
    throw new ValidationError("Некорректная дата процедуры");
  }
  if (процедура.getTime() < Date.now()) {
    // План подготовки к уже прошедшей процедуре бессмыслен, и чаще всего
    // это опечатка в дате, которую лучше поймать здесь.
    throw new ValidationError("Дата процедуры уже прошла");
  }

  const ролики = await Video.find({
    _id: { $in: plan.steps.map((ш) => ш.videoId) },
  }).select("title media.durationSec");
  const поId = new Map(ролики.map((р) => [asId(р._id), р]));

  const steps = plan.steps.map((ш) => {
    const р = поId.get(asId(ш.videoId));
    return {
      videoId: ш.videoId,
      title: р?.title || "",
      durationSec: р?.media?.durationSec || 0,
      offsetDays: ш.offsetDays,
      dueAt: new Date(процедура.getTime() - ш.offsetDays * 86400000),
      required: ш.required,
      note: ш.note,
    };
  });

  const assignment = await VideoPlaylistAssignment.create({
    clinicId: actor.clinicId,
    playlistId: plan._id,
    clinicPatientId: data.clinicPatientId,
    patientUserId: data.patientUserId,
    appointmentId: data.appointmentId || null,
    title: plan.title,
    procedureName: plan.procedureName,
    procedureAt: процедура,
    steps,
    assignedByMembershipId: actor.membershipId || null,
  });

  // Доставка — половина смысла назначения: план, о котором пациент не
  // узнал, ничем не отличается от отсутствующего. Колокольчик и чат, как и
  // у согласия; сбой канала само назначение не отменяет.
  await deliverPlaylistAssignment({
    assignment,
    fromUserId: actor.ownerType === "user" ? actor.ownerId : null,
  });

  return assignment;
}

/**
 * Продвинуть шаги плана по факту просмотра.
 *
 * Вызывается из учёта просмотра, вместе с продвижением согласий. Один
 * ролик может стоять в нескольких планах — например, «как устроен желудок»
 * перед гастроскопией и перед операцией; засчитываем во всех.
 */
export async function registerWatch({ patientUserId, videoId, watchedSec, ratio, completed }) {
  if (!patientUserId || !videoId) return { updated: 0 };

  const назначения = await VideoPlaylistAssignment.find({
    patientUserId,
    cancelledAt: null,
    "steps.videoId": videoId,
  });

  let закрыто = 0;
  for (const назначение of назначения) {
    let менялось = false;
    for (const шаг of назначение.steps) {
      if (asId(шаг.videoId) !== asId(videoId)) continue;
      шаг.watchedSec = Math.max(шаг.watchedSec, watchedSec);
      шаг.ratio = Math.max(шаг.ratio, Math.min(ratio, 1));
      if (completed && !шаг.completedAt) {
        шаг.completedAt = new Date();
        закрыто += 1;
      }
      менялось = true;
    }
    if (менялось) await назначение.save();
  }

  return { updated: назначения.length, completed: закрыто };
}

/* ═══════════ чтение ═══════════ */

/** Кабинет пациента: что и к какому сроку посмотреть. */
export async function listMyAssignments({ actor }) {
  const items = await VideoPlaylistAssignment.find({
    patientUserId: actor.ownerId,
    cancelledAt: null,
  })
    .sort({ procedureAt: 1 })
    .limit(50);
  return { items };
}

/** Клиника: готов ли пациент к процедуре. */
export async function listPatientAssignments({ actor, clinicPatientId }) {
  if (!clinicCan(actor, "read")) throw new ForbiddenError("Нет доступа");
  const items = await VideoPlaylistAssignment.find({
    clinicId: actor.clinicId,
    clinicPatientId,
  })
    .sort({ procedureAt: -1 })
    .limit(50);
  return { items };
}

/** Назначения по приёму — «готов ли тот, кто придёт сегодня». */
export async function listAppointmentAssignments({ actor, appointmentId }) {
  if (!clinicCan(actor, "read")) throw new ForbiddenError("Нет доступа");
  if (!mongoose.isValidObjectId(appointmentId)) return { items: [] };
  const items = await VideoPlaylistAssignment.find({
    clinicId: actor.clinicId,
    appointmentId,
  }).sort({ createdAt: -1 });
  return { items };
}

export async function cancelAssignment({ actor, id }) {
  if (!clinicCan(actor, "write")) throw new ForbiddenError("Нет права отменять назначение");
  const назначение = await VideoPlaylistAssignment.findOne({
    _id: id,
    clinicId: actor.clinicId,
  });
  if (!назначение) throw new NotFoundError("Назначение не найдено");
  назначение.cancelledAt = new Date();
  await назначение.save();
  return назначение;
}

export default {
  createPlaylist,
  listPlaylists,
  deactivatePlaylist,
  assignPlaylist,
  registerWatch,
  listMyAssignments,
  listPatientAssignments,
  listAppointmentAssignments,
  cancelAssignment,
};
