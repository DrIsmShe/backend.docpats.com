// server/modules/scribe/services/scribe.service.js
// ─────────────────────────────────────────────────────────────────────
//   Запись приёма: согласие → приём кусков → расшифровка → черновик.
//
//   Движок распознавания и сборки НЕ дублируется: расшифрованный диалог
//   уходит в существующий конвейер надиктовки (modules/dictation), где
//   уже решены очередь, повторы, шифрование PHI и удаление аудио. Здесь
//   только то, чего у надиктовки нет: две стороны, согласие и авторство
//   реплик.
// ─────────────────────────────────────────────────────────────────────

import ScribeSession from "../models/scribeSession.model.js";
import TelemedSession from "../../clinic/clinic-telemed/models/telemedSession.model.js";
import ClinicPatient from "../../clinic/clinic-patients/models/clinicPatient.model.js";
import { transcribe } from "../../dictation/providers/stt.provider.js";
import {
  ValidationError,
  NotFoundError,
  ForbiddenError,
} from "../../../common/utils/errors.js";
import logger from "../../../common/logger.js";

const log = logger.child({ module: "scribe" });

// Кусок в 20 секунд — компромисс, а не круглое число: короче — счёт
// запросов к распознаванию растёт быстрее пользы, длиннее — врач дольше
// ждёт черновик после «Завершить», потому что хвост очереди длиннее.
export const CHUNK_TARGET_SEC = 20;

// Потолок на приём. Двухчасовая запись — это не приём, а забытая
// кнопка; распознавать её значит заплатить за чужую невнимательность.
export const MAX_SESSION_SEC = 90 * 60;

/** Участник по идентификатору. */
function participantOf(session, userId) {
  return session.participants.find(
    (p) => String(p.userId) === String(userId),
  );
}

/**
 * Врач начинает запись.
 *
 * Сеанс создаётся в состоянии awaiting_consent: до ответа пациента не
 * записывается НИЧЕГО, включая речь самого врача. Записать половину
 * разговора без согласия второй стороны — то же самое, что записать
 * весь: в кабинете звучит и голос пациента.
 */
export async function startSession({
  doctorId,
  room,
  patientUserId,
  appointmentId = null,
  clinicId = null,
  telemedSessionId = null,
  lang = "",
}) {
  if (!room) throw new ValidationError("Не указана комната приёма");

  // ─── КАРТА ИЗ ТЕЛЕМЕД-ПРИЁМА ─────────────────────────────────────
  //
  // У назначенного приёма карта пациента известна ЗАРАНЕЕ — она указана
  // в самом сеансе. Искать её потом по аккаунту незачем и вредно: поиск
  // может не найти (карта не связана с аккаунтом, пациент в клинике
  // впервые), и врач упрётся в тупик с уже записанным разговором.
  //
  // Здесь гадать не о чем: кто перед врачом, приём знал до его начала.
  let patientRef = null;
  let patientTypeModel = null;
  let resolvedClinicId = clinicId;
  let resolvedPatientUser = patientUserId;

  if (telemedSessionId) {
    const tele = await TelemedSession.findById(telemedSessionId)
      .select("clinicId patientId")
      .setOptions({ skipTenantScope: true })
      .lean();

    if (tele?.patientId) {
      const card = await ClinicPatient.findById(tele.patientId)
        .select("linkedUserId clinicId")
        .setOptions({ skipTenantScope: true })
        .lean();

      if (card) {
        patientRef = card._id;
        patientTypeModel = "ClinicPatient";
        resolvedClinicId = resolvedClinicId || card.clinicId || tele.clinicId;
        // Пациент для согласия — владелец карты. Если карта ни к кому не
        // привязана, остаётся тот, кого передал звонок: в комнате всё
        // равно кто-то есть, и спрашивать согласие надо у него.
        resolvedPatientUser = card.linkedUserId || patientUserId;
      }
    }
  }

  if (!resolvedPatientUser) throw new ValidationError("Не указан пациент");

  // Один активный сеанс на комнату: два параллельных писали бы один и
  // тот же разговор дважды и стоили бы вдвое.
  const existing = await ScribeSession.findOne({
    room,
    status: { $in: ["awaiting_consent", "recording"] },
  });
  if (existing) return existing;

  return ScribeSession.create({
    room,
    appointmentId,
    clinicId: resolvedClinicId,
    doctorId,
    patientRef,
    patientTypeModel,
    // Язык приёма один на обе стороны — см. комментарий у поля в модели.
    lang: String(lang || "")
      .slice(0, 10)
      .toLowerCase(),
    participants: [
      // Врач, начавший запись, согласием считается сразу: нажатие
      // кнопки и есть его согласие, спрашивать дважды незачем.
      { userId: doctorId, role: "doctor", consent: "granted", consentAt: new Date() },
      { userId: resolvedPatientUser, role: "patient", consent: "pending" },
    ],
    status: "awaiting_consent",
  });
}

/**
 * Ответ на запрос согласия.
 *
 * Отказ переводит сеанс в declined безвозвратно: повторно спрашивать
 * человека, который уже отказался, — давление, а не уточнение.
 */
export async function respondToConsent({ sessionId, userId, granted }) {
  const session = await ScribeSession.findById(sessionId);
  if (!session) throw new NotFoundError("Сеанс записи не найден");

  const me = participantOf(session, userId);
  if (!me) throw new ForbiddenError("Вы не участник этого приёма");

  if (!granted) {
    me.consent = "declined";
    me.consentAt = new Date();
    session.status = "declined";
    await session.save();
    log.info({ sessionId: String(session._id) }, "Запись отклонена пациентом");
    return session;
  }

  me.consent = "granted";
  me.consentAt = new Date();

  // Записывать начинаем, только когда согласны ВСЕ. Достаточно одного
  // «pending», чтобы не начать.
  const everyone = session.participants.every((p) => p.consent === "granted");
  if (everyone) session.status = "recording";

  await session.save();
  return session;
}

/**
 * Отзыв согласия во время приёма.
 *
 * Уже присланное этой стороной удаляется. Право прервать, не
 * действующее назад, ничего не стоит: человек прерывает запись именно
 * потому, что не хочет, чтобы сказанное сохранилось.
 */
export async function revokeConsent({ sessionId, userId }) {
  const session = await ScribeSession.findById(sessionId);
  if (!session) throw new NotFoundError("Сеанс записи не найден");

  const me = participantOf(session, userId);
  if (!me) throw new ForbiddenError("Вы не участник этого приёма");

  me.consent = "revoked";
  me.consentAt = new Date();
  session.status = "revoked";
  // Стираем реплики отозвавшего. Реплики второй стороны остаются: его
  // согласие никто не отзывал, и удалять его слова мы не вправе.
  session.segments = session.segments.filter((s) => s.speaker !== me.role);
  await session.save();

  log.info(
    { sessionId: String(session._id), role: me.role },
    "Согласие отозвано, реплики стороны удалены",
  );
  return session;
}

/**
 * Приём куска аудио от одной из сторон.
 *
 * Распознаётся сразу, а не копится: к моменту «Завершить» расшифровка
 * почти готова, и врач получает черновик за секунды вместо минут.
 * Аудио при этом никуда не сохраняется — в базу идёт только текст.
 */
export async function ingestChunk({
  sessionId,
  userId,
  buffer,
  startSec,
  lang = "",
}) {
  const session = await ScribeSession.findById(sessionId);
  if (!session) throw new NotFoundError("Сеанс записи не найден");

  if (session.status !== "recording") {
    // Не ошибка клиента: браузер мог отправить кусок, который уже был в
    // пути, когда согласие отозвали. Молча отбрасываем.
    return { accepted: false, reason: session.status };
  }

  const me = participantOf(session, userId);
  if (!me) throw new ForbiddenError("Вы не участник этого приёма");
  if (me.consent !== "granted") {
    return { accepted: false, reason: "consent" };
  }

  const total = session.participants.reduce((a, p) => a + p.seconds, 0);
  if (total > MAX_SESSION_SEC) {
    session.status = "finishing";
    await session.save();
    return { accepted: false, reason: "limit" };
  }

  // Язык берём ИЗ СЕАНСА, а не из запроса: его назвал врач до начала
  // записи, и он один на обе стороны. Браузер пациента о выборе врача не
  // знает и прислал бы язык своего интерфейса — половина приёма ушла бы
  // на распознавание не на том языке.
  //
  // allowEmpty: приём пишется кусками по 20 секунд, и молчание в куске —
  // обычное дело (говорит второй участник, пауза, осмотр). Ронять на этом
  // отправку значило бы сыпать ошибками в исправно идущем приёме.
  const { text, durationSec } = await transcribe({
    buffer,
    filename: `scribe-${me.role}.webm`,
    lang: session.lang || lang,
    allowEmpty: true,
  });

  const clean = String(text || "").trim();
  if (clean) {
    session.segments.push({
      speaker: me.role,
      startSec: Number(startSec) || 0,
      text: clean,
    });
  }

  me.chunks += 1;
  me.seconds += durationSec || 0;
  await session.save();

  return { accepted: true, empty: !clean };
}

/**
 * Диалог одной строкой — вход для сборки структуры.
 *
 * Реплики упорядочены по времени НАЧАЛА, а не по приходу: куски от двух
 * браузеров прилетают вперемешку, и порядок приёма к порядку разговора
 * отношения не имеет. Перепутанный порядок превращает ответ в вопрос.
 */
export function dialogueText(session) {
  return [...session.segments]
    .sort((a, b) => a.startSec - b.startSec)
    .map((s) => `${s.speaker === "doctor" ? "Врач" : "Пациент"}: ${s.text}`)
    .join("\n");
}

export default {
  startSession,
  respondToConsent,
  revokeConsent,
  ingestChunk,
  dialogueText,
  CHUNK_TARGET_SEC,
  MAX_SESSION_SEC,
};
