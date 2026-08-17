// server/modules/doctorsProfiles/services/competence.service.js
// ─────────────────────────────────────────────────────────────────────
//   Подтверждённая учебная активность врача.
//
//   ЧТО ЭТО. У платформы есть тренажёр чтения снимков, банк экзаменных
//   вопросов и симуляция — то есть объективные данные о том, что врач
//   регулярно тренируется и с каким результатом. Ни у одного конкурента
//   такого сигнала нет, потому что не у всех есть тренажёр.
//
//   ─── ЧЕГО ЭТИ ЦИФРЫ НЕ ЗНАЧАТ ─────────────────────────────────────
//
//   Это НЕ оценка клинической квалификации, и называть их так нельзя
//   ни в интерфейсе, ни в переписке с клиниками. Врач, разобравший
//   двести учебных снимков, не становится лучшим рентгенологом города —
//   он становится врачом, который регулярно тренируется. Разница
//   существенная, и подменять одно другим значит вводить в заблуждение
//   пациента, который выбирает врача по этой цифре.
//
//   ─── ПОЧЕМУ ПОКАЗ ТОЛЬКО ПО СОГЛАСИЮ ──────────────────────────────
//
//   Автоматическая публикация точности наказывает того, кто тренируется
//   и ошибается, — то есть ровно того, ради кого тренажёр и сделан.
//   Врач, увидевший свою невысокую точность на публичном профиле,
//   перестанет тренироваться, и платформа потеряет и данные, и смысл
//   модуля. Поэтому по умолчанию ВЫКЛЮЧЕНО, включает врач сам.
//
//   ─── ПОЧЕМУ ЕСТЬ ПОРОГ ────────────────────────────────────────────
//
//   Точность по трём случаям — это шум, а не показатель: одна ошибка
//   меняет её на треть. Ниже порога показываем только активность,
//   без процента. Цифра, которая скачет, хуже её отсутствия.
// ─────────────────────────────────────────────────────────────────────

import mongoose from "mongoose";
import RadiologyAttempt from "../../radiology/radiology-attempts/models/radiologyAttempt.model.js";
import ExamAttempt from "../../education/education-attempts/models/examAttempt.model.js";
import User from "../../../common/models/Auth/users.js";

// Окно, за которое считаем. Год: активность двухлетней давности не
// говорит о том, тренируется ли человек сейчас.
const WINDOW_MS = 365 * 24 * 60 * 60 * 1000;

// Ниже этого числа разобранных случаев процент не показываем.
export const MIN_CASES_FOR_ACCURACY = 20;

// То же для вопросов: они короче, и порог выше.
export const MIN_QUESTIONS_FOR_ACCURACY = 100;

/** Разобранные снимки и средний балл. */
async function radiologyStats(userId, since) {
  const rows = await RadiologyAttempt.aggregate([
    {
      $match: {
        userId: new mongoose.Types.ObjectId(String(userId)),
        status: "submitted",
        updatedAt: { $gte: since },
      },
    },
    {
      $group: {
        _id: null,
        cases: { $sum: 1 },
        avgScore: { $avg: "$score.total" },
        passed: { $sum: { $cond: ["$score.passed", 1, 0] } },
      },
    },
  ]);

  const r = rows[0];
  if (!r || !r.cases) return { cases: 0, accuracy: null, passed: 0 };

  return {
    cases: r.cases,
    passed: r.passed,
    // Процент только при достаточном объёме — иначе это шум.
    accuracy:
      r.cases >= MIN_CASES_FOR_ACCURACY
        ? Math.round((r.avgScore || 0) * 100)
        : null,
  };
}

/** Отвеченные вопросы и доля верных. */
async function examStats(userId, since) {
  const rows = await ExamAttempt.aggregate([
    {
      $match: {
        userId: new mongoose.Types.ObjectId(String(userId)),
        createdAt: { $gte: since },
      },
    },
    { $unwind: { path: "$responses", preserveNullAndEmptyArrays: false } },
    {
      $group: {
        _id: null,
        answered: { $sum: 1 },
        correct: {
          $sum: { $cond: [{ $eq: ["$responses.isCorrect", true] }, 1, 0] },
        },
      },
    },
  ]);

  const r = rows[0];
  if (!r || !r.answered) return { answered: 0, accuracy: null };

  return {
    answered: r.answered,
    accuracy:
      r.answered >= MIN_QUESTIONS_FOR_ACCURACY
        ? Math.round((r.correct / r.answered) * 100)
        : null,
  };
}

/**
 * Активность врача за год.
 *
 * @param {string} userId
 * @param {object} [opts]
 * @param {boolean} [opts.forSelf] — свой профиль: отдаём всегда, даже
 *   когда публикация выключена. Врач должен видеть свои цифры, чтобы
 *   решить, показывать ли их.
 */
export async function getCompetence(userId, { forSelf = false } = {}) {
  const user = await User.findById(userId)
    .select("role publicCompetence")
    .lean();
  if (!user) return null;
  if (user.role !== "doctor") return null;

  const enabled = user.publicCompetence?.enabled === true;
  if (!enabled && !forSelf) return null;

  const since = new Date(Date.now() - WINDOW_MS);
  const [radiology, exam] = await Promise.all([
    radiologyStats(userId, since),
    examStats(userId, since),
  ]);

  // Профиль без активности не показываем вовсе: пустые нули читаются
  // как «врач ничего не делает», хотя он мог просто не пользоваться
  // тренажёром, который к его работе отношения не имеет.
  const hasActivity = radiology.cases > 0 || exam.answered > 0;
  if (!hasActivity) return null;

  return {
    enabled,
    periodDays: Math.round(WINDOW_MS / 86400000),
    radiology,
    exam,
    // Формулировка возвращается сервером, а не собирается на клиенте:
    // это утверждение о человеке, и оно не должно зависеть от того,
    // какой экран его показывает.
    caption:
      "Учебная активность на платформе за год. Это не оценка " +
      "клинической квалификации.",
  };
}

/** Врач включает или выключает показ. */
export async function setCompetenceVisibility(userId, enabled) {
  await User.updateOne(
    { _id: userId },
    { $set: { "publicCompetence.enabled": Boolean(enabled) } },
  );
  return { enabled: Boolean(enabled) };
}

export default { getCompetence, setCompetenceVisibility };
