// server/modules/webinar/services/webinar.service.js

import mongoose from "mongoose";

import { mintRoomToken, isJitsiConfigured } from "../../../common/video/jitsiToken.service.js";
import {
  ForbiddenError,
  NotFoundError,
  ServiceUnavailableError,
  ValidationError,
} from "../../../common/utils/errors.js";
import Webinar from "../models/Webinar.model.js";

/* ============================================================
   ДОСТУП
   ============================================================
   Одно место, где решается «пускать или нет», и все пути к
   комнате идут через него. Разложи проверку по контроллерам —
   и однажды один из них забудет спросить.
   ============================================================ */

async function loadWebinar(webinarId) {
  if (!mongoose.isValidObjectId(webinarId)) {
    throw new ValidationError("Некорректный идентификатор встречи");
  }
  const webinar = await Webinar.findById(webinarId);
  if (!webinar) throw new NotFoundError("Встреча не найдена");
  return webinar;
}

export async function createWebinar({ hostId, data }) {
  const {
    title,
    description,
    accessMode,
    invitedUserIds,
    // coHostIds здесь легко потерять: маршрут его принимает, схема
    // проверяет, а сервис молча не переносил — соведущие оставались
    // без прав модератора, и узнал бы об этом ведущий уже во встрече.
    coHostIds,
    lobbyEnabled,
    scheduledAt,
    maxParticipants,
  } = data;

  return Webinar.create({
    title,
    description: description || "",
    hostId,
    accessMode: accessMode || "link",
    invitedUserIds: Array.isArray(invitedUserIds) ? invitedUserIds : [],
    coHostIds: Array.isArray(coHostIds) ? coHostIds : [],
    lobbyEnabled: Boolean(lobbyEnabled),
    scheduledAt: scheduledAt || null,
    ...(maxParticipants ? { maxParticipants } : {}),
  });
}

/** Встречи, которые человек ведёт или на которые позван. */
export async function listWebinars(userId) {
  return Webinar.find({
    status: { $ne: "ended" },
    $or: [
      { hostId: userId },
      { coHostIds: userId },
      { invitedUserIds: userId },
    ],
  })
    .sort({ scheduledAt: 1, createdAt: -1 })
    .lean();
}

/**
 * Карточка встречи для страницы входа.
 * Отдаётся и тем, кого не пустят: человек, пришедший по ссылке, должен
 * увидеть название и понятное «вас сюда не звали», а не голый 403 без
 * объяснения.
 */
export async function getWebinarForJoin({ webinarId, userId }) {
  const webinar = await loadWebinar(webinarId);

  return {
    _id: webinar._id,
    title: webinar.title,
    description: webinar.description,
    scheduledAt: webinar.scheduledAt,
    status: webinar.status,
    lobbyEnabled: webinar.lobbyEnabled,
    accessMode: webinar.accessMode,
    isHost: String(webinar.hostId) === String(userId),
    isModerator: webinar.isModerator(userId),
    mayJoin: webinar.mayJoin(userId),
  };
}

export async function updateWebinar({ webinarId, userId, patch }) {
  const webinar = await loadWebinar(webinarId);
  // Править встречу может только ведущий. Соведущий модерирует комнату,
  // но не переписывает условия входа.
  if (String(webinar.hostId) !== String(userId)) {
    throw new ForbiddenError("Менять встречу может только ведущий");
  }

  const allowed = [
    "title",
    "description",
    "accessMode",
    "invitedUserIds",
    "coHostIds",
    "lobbyEnabled",
    "scheduledAt",
    "status",
    "maxParticipants",
  ];
  for (const key of allowed) {
    if (patch[key] !== undefined) webinar[key] = patch[key];
  }
  await webinar.save();
  return webinar;
}

export async function deleteWebinar({ webinarId, userId }) {
  const webinar = await loadWebinar(webinarId);
  if (String(webinar.hostId) !== String(userId)) {
    throw new ForbiddenError("Удалить встречу может только ведущий");
  }
  await webinar.deleteOne();
}

/* ============================================================
   ПРОПУСК В КОМНАТУ
   ============================================================ */

export async function issueWebinarToken({ webinarId, userId, displayName, email }) {
  if (!isJitsiConfigured()) {
    throw new ServiceUnavailableError("Видеосвязь не настроена");
  }

  const webinar = await loadWebinar(webinarId);

  if (!webinar.mayJoin(userId)) {
    throw new ForbiddenError("Вас не пригласили на эту встречу");
  }

  // Первый вошедший переводит встречу в «идёт». Отдельной кнопки
  // «начать» нет намеренно: ведущий и так открывает комнату, а лишний
  // шаг между ним и участниками — лишний повод для путаницы.
  if (webinar.status === "scheduled") {
    webinar.status = "live";
    await webinar.save();
  }

  // Модератор — ведущий и соведущие. Право пускать из комнаты ожидания
  // и выключать чужие микрофоны у остальных быть не должно.
  const moderator = webinar.isModerator(userId);

  const minted = mintRoomToken({
    room: webinar.roomName(),
    userId: String(userId),
    displayName: displayName || null,
    email: email || null,
    moderator,
  });

  // Флаг отдаём рядом с токеном: Jitsi читает его из подписанного
  // JWT, а интерфейсу он нужен снаружи, чтобы показать ведущему
  // управление встречей. Разбирать токен на клиенте ради этого —
  // лишний способ ошибиться.
  return { ...minted, moderator, lobbyEnabled: webinar.lobbyEnabled };
}

export default {
  createWebinar,
  listWebinars,
  getWebinarForJoin,
  updateWebinar,
  deleteWebinar,
  issueWebinarToken,
};
