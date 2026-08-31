// server/modules/previsit/services/previsit.service.js
// ─────────────────────────────────────────────────────────────────────
//   Опрос перед приёмом: пригласить → заполнить → показать врачу.
//
//   ГЛАВНОЕ РЕШЕНИЕ ЭТОГО ФАЙЛА. Ответы пациента сохраняются ВСЕГДА —
//   даже если квота клиники исчерпана, модель недоступна или ключ не
//   задан. Разбор в этом случае просто не создаётся.
//
//   Причина: анкету заполняет человек, который потратил на неё пять
//   минут своего вечера. Потерять его рассказ из-за нашего лимита —
//   это наказать пациента за расчёты между нами и клиникой. Врач и без
//   разбора прочтёт ответы; разбор экономит ему двадцать секунд, а
//   ответы — весь приём.
// ─────────────────────────────────────────────────────────────────────

import PrevisitIntake from "../models/previsitIntake.model.js";
import ClinicAppointment from "../../clinic/clinic-appointments/models/clinicAppointment.model.js";
import { QUESTIONS, URGENT, labelFor } from "../questions.js";
import { composeIntake } from "../ai/intakeComposer.js";
import { assertIntakeAllowed } from "./previsitQuota.service.js";
import {
  createSignedToken,
  verifySignedToken,
} from "../../../common/utils/signedUrl.js";
import {
  ValidationError,
  NotFoundError,
} from "../../../common/utils/errors.js";
import logger from "../../../common/logger.js";

const log = logger.child({ module: "previsit" });

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Создать (или вернуть) анкету для приёма и подписанную ссылку.
 *
 * Ссылка живёт до приёма плюс сутки: после приёма анкета бесполезна, а
 * вечная ссылка — способ открыть чужие ответы по пересланному письму.
 */
export async function inviteToIntake({ appointmentId }) {
  const appt = await ClinicAppointment.findById(appointmentId)
    .select("clinicId patientId doctorId startUTC")
    .setOptions({ skipTenantScope: true })
    .lean();
  if (!appt) throw new NotFoundError("Приём не найден", { i18n: "app.appointment.notFound4" });

  let intake = await PrevisitIntake.findOne({ appointmentId });
  if (!intake) {
    intake = await PrevisitIntake.create({
      appointmentId,
      clinicId: appt.clinicId,
      patientId: appt.patientId,
      doctorId: appt.doctorId || null,
    });
  }

  // Срок жизни считаем от приёма, а не фиксированным числом дней:
  // запись могли сделать за месяц, и ссылка на неделю протухла бы
  // раньше, чем пациент собрался её открыть.
  const until = new Date(appt.startUTC).getTime() + DAY_MS;
  const ttlSeconds = Math.max(
    3600,
    Math.floor((until - Date.now()) / 1000),
  );

  const token = createSignedToken(
    { intakeId: String(intake._id) },
    `${ttlSeconds}s`,
  );

  return { intakeId: String(intake._id), token, expiresAt: new Date(until) };
}

/** Анкета по токену — то, что видит пациент. */
export async function getIntakeByToken(token) {
  let payload;
  try {
    payload = verifySignedToken(token);
  } catch {
    throw new ValidationError(
      "Ссылка недействительна или срок её действия истёк. " +
        "Попросите клинику прислать новую.",
    );
  }

  const intake = await PrevisitIntake.findById(payload.intakeId).lean();
  if (!intake) throw new NotFoundError("Анкета не найдена", { i18n: "app.previsit.formNotFound" });

  return {
    id: String(intake._id),
    status: intake.status,
    // Вопросы отдаём вместе с анкетой: их набор живёт в коде сервера, и
    // клиент не должен носить свою копию, которая однажды разойдётся.
    questions: QUESTIONS,
    answers: intake.answers || {},
    submittedAt: intake.submittedAt,
  };
}

/** Проверка ответов по каталогу вопросов. */
function validate(answers) {
  const clean = {};
  for (const q of QUESTIONS) {
    const raw = answers?.[q.id];

    if (q.type === "multi") {
      const values = Array.isArray(raw) ? raw : [];
      const allowed = new Set(q.options.map((o) => o.value));
      clean[q.id] = values.filter((v) => allowed.has(v));
      continue;
    }

    if (q.type === "choice") {
      const allowed = new Set(q.options.map((o) => o.value));
      if (raw && allowed.has(raw)) clean[q.id] = raw;
      else if (q.required) {
        throw new ValidationError(`Ответьте на вопрос: «${q.label}»`);
      }
      continue;
    }

    const text = String(raw ?? "").trim();
    if (!text && q.required) {
      throw new ValidationError(`Ответьте на вопрос: «${q.label}»`);
    }
    if (text) clean[q.id] = text.slice(0, q.maxLength || 1000);
  }
  return clean;
}

/** Строки для модели: человеческие подписи вместо кодов. */
function toRows(answers) {
  return QUESTIONS.map((q) => {
    const v = answers[q.id];
    if (v === undefined || v === null || v === "") return null;
    if (q.type === "multi") {
      if (!v.length) return null;
      return { label: q.label, value: v.map((x) => labelFor(q.id, x)).join(", ") };
    }
    if (q.type === "choice") return { label: q.label, value: labelFor(q.id, v) };
    return { label: q.label, value: v };
  }).filter(Boolean);
}

/**
 * Пациент отправил анкету.
 *
 * Порядок: сохранить ответы → попытаться разобрать. Не наоборот.
 */
export async function submitIntake({ token, answers, language = "ru" }) {
  let payload;
  try {
    payload = verifySignedToken(token);
  } catch {
    throw new ValidationError("Ссылка недействительна или истекла", { i18n: "app.previsit.linkInvalidOrExpired" });
  }

  const intake = await PrevisitIntake.findById(payload.intakeId);
  if (!intake) throw new NotFoundError("Анкета не найдена", { i18n: "app.previsit.formNotFound" });

  const clean = validate(answers);
  const redFlags = Array.isArray(clean.redFlags) ? clean.redFlags : [];

  // 1. Ответы — в базу немедленно и безусловно.
  intake.answers = clean;
  intake.redFlags = redFlags;
  intake.status = "submitted";
  intake.submittedAt = new Date();
  await intake.save();

  // 2. Разбор — попытка, а не условие. Любой отказ здесь оставляет
  // анкету заполненной: рассказ пациента важнее нашей выжимки.
  try {
    if (intake.doctorId) await assertIntakeAllowed(intake.doctorId);

    const composed = await composeIntake({ rows: toRows(clean), language });
    intake.narrative = composed.narrative;
    intake.clarify = composed.clarify;
    intake.provenance = {
      model: composed.model || null,
      promptVersion: composed.promptVersion,
    };
    await intake.save();
  } catch (err) {
    log.warn(
      { intakeId: String(intake._id), err: err.message },
      "Анкета сохранена без разбора",
    );
  }

  // Срочные признаки возвращаем пациенту СРАЗУ. Человек, отметивший
  // боль в груди, не должен ждать приёма через неделю, и узнать об этом
  // он должен от нас, а не догадаться.
  const urgent = redFlags.filter((f) => URGENT.has(f));

  return {
    id: String(intake._id),
    submittedAt: intake.submittedAt,
    urgent: urgent.map((f) => labelFor("redFlags", f)),
  };
}

/** Анкета приёма — то, что видит врач. */
export async function getIntakeForAppointment({ appointmentId }) {
  const intake = await PrevisitIntake.findOne({ appointmentId }).lean();
  if (!intake || intake.status !== "submitted") return null;
  return toDoctorShape(intake);
}

/** Последняя заполненная анкета пациента — для сводки в карте. */
export async function getLatestIntakeForPatient({ patientId }) {
  const intake = await PrevisitIntake.findOne({
    patientId,
    status: "submitted",
  })
    .sort({ submittedAt: -1 })
    .lean();
  if (!intake) return null;
  return toDoctorShape(intake);
}

/** Форма для врача: слова, а не коды, и всегда исходные ответы. */
export function toDoctorShape(intake) {
  return {
    id: String(intake._id),
    submittedAt: intake.submittedAt,
    narrative: intake.narrative || "",
    clarify: intake.clarify || [],
    redFlags: (intake.redFlags || []).map((f) => ({
      value: f,
      label: labelFor("redFlags", f),
      urgent: URGENT.has(f),
    })),
    // Исходные ответы отдаются ВСЕГДА, а не только когда разбора нет:
    // врач должен иметь возможность прочитать слова пациента, а не
    // только наш пересказ.
    answers: QUESTIONS.map((q) => {
      const v = intake.answers?.[q.id];
      if (v === undefined || v === null || v === "") return null;
      if (q.type === "multi") {
        if (!Array.isArray(v) || !v.length) return null;
        return { label: q.label, value: v.map((x) => labelFor(q.id, x)).join(", ") };
      }
      if (q.type === "choice") return { label: q.label, value: labelFor(q.id, v) };
      return { label: q.label, value: v };
    }).filter(Boolean),
  };
}

export default {
  inviteToIntake,
  getIntakeByToken,
  submitIntake,
  getIntakeForAppointment,
  getLatestIntakeForPatient,
};
