// server/modules/education/services/quota.service.js
//
// Квота вопросов в модуле подготовки к экзаменам.
//
// Уровни доступа:
//   гость               — 20 вопросов всего, только тесты с isFree
//   зарегистрированный  — 250 вопросов в месяц (patient_free)
//   аддон Exam Prep     — 2000/мес или безлимит
//   старшие планы       — безлимит включён в цену
//
// Цифры не живут здесь: они в common/config/aiPlanLimits.js вместе с
// остальными тарифными лимитами. Этот модуль отвечает только за подсчёт
// расхода и решение «пускать или нет».
//
// Почему расход считается запросом к exam_attempts, а не отдельным
// счётчиком: так уже устроены AI-лимиты (userSynthesis считает статьи с
// начала месяца). Счётчик пришлось бы сбрасывать по cron и чинить после
// каждого расхождения, а агрегат по попыткам не врёт по определению и
// обнуляется сам при смене месяца.
//
// Единица расхода — ОТВЕЧЕННЫЙ вопрос (responses), а не выданный. Бросил
// попытку на третьем вопросе — списалось три. answer() обновляет ответ на
// месте, а не добавляет второй, поэтому размер массива равен числу
// отвеченных вопросов.

import ExamAttempt from "../education-attempts/models/examAttempt.model.js";
import User from "../../../common/models/Auth/users.js";
import {
  resolveExamQuestionLimit,
  EXAM_ADDON_DISPLAY_NAMES,
  PLAN_DISPLAY_NAMES,
} from "../../../common/config/aiPlanLimits.js";
import { QuotaExceededError } from "../../../common/utils/errors.js";

// Гостю квота даётся один раз и не восстанавливается: это демо-проход, а
// не бесплатный тариф. Отсюда и отсутствие периода в его ветке.
export const GUEST_PLAN = "guest";

/** Начало текущего календарного месяца по времени сервера. */
export function startOfCurrentMonth(now = new Date()) {
  const d = new Date(now);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Сколько вопросов отвечено в попытках, попадающих под фильтр.
 * Считаем размером массива ответов — без выгрузки самих попыток.
 */
async function countAnswered(match) {
  const [row] = await ExamAttempt.aggregate([
    { $match: match },
    { $project: { answered: { $size: { $ifNull: ["$responses", []] } } } },
    { $group: { _id: null, used: { $sum: "$answered" } } },
  ]);
  return row?.used ?? 0;
}

/**
 * Текущее состояние квоты.
 *
 * @param {object} args
 * @param {string|import("mongoose").Types.ObjectId|null} [args.userId]
 * @param {string|null} [args.guestSessionId] — используется, только если нет userId
 * @returns {Promise<{isGuest: boolean, plan: string, planLabel: string,
 *   addon: string|null, addonLabel: string|null, limit: number, used: number,
 *   remaining: number, unlimited: boolean, periodStart: Date|null,
 *   periodEnd: Date|null}>}
 */
export async function getExamQuota({ userId = null, guestSessionId = null }) {
  if (!userId) {
    if (!guestSessionId) {
      throw new Error("getExamQuota: нужен userId или guestSessionId");
    }
    const { limit, plan } = resolveExamQuestionLimit(null);
    const used = await countAnswered({ guestSessionId });
    return {
      isGuest: true,
      plan,
      planLabel: PLAN_DISPLAY_NAMES[plan] ?? plan,
      addon: null,
      addonLabel: null,
      limit,
      used,
      remaining: Math.max(0, limit - used),
      unlimited: false,
      // Гостевая квота не возобновляется — периода нет.
      periodStart: null,
      periodEnd: null,
    };
  }

  const user = await User.findById(userId)
    .select("role subscriptionPlan subscriptionEndsAt trialEndsAt examAddon examAddonEndsAt")
    .lean();

  const { limit, plan, addon } = resolveExamQuestionLimit(user);
  const unlimited = limit === -1;

  const periodStart = startOfCurrentMonth();
  const periodEnd = new Date(periodStart);
  periodEnd.setMonth(periodEnd.getMonth() + 1);

  // Безлимиту расход всё равно считаем: он попадает в ответ и виден в UI
  // как «пройдено в этом месяце» — полезнее, чем прочерк.
  const used = await countAnswered({
    userId: user?._id ?? userId,
    startedAt: { $gte: periodStart },
  });

  return {
    isGuest: false,
    plan,
    planLabel: PLAN_DISPLAY_NAMES[plan] ?? plan,
    addon,
    addonLabel: addon ? EXAM_ADDON_DISPLAY_NAMES[addon] : null,
    limit,
    used,
    remaining: unlimited ? Infinity : Math.max(0, limit - used),
    unlimited,
    periodStart,
    periodEnd,
  };
}

/**
 * Проверка перед выдачей вопросов.
 *
 * Возвращает, сколько вопросов можно выдать: если у человека осталось 12,
 * а он просит 60, честнее собрать попытку на 12, чем отказать целиком.
 * Отказ — только когда не осталось ничего.
 *
 * @returns {Promise<{quota: object, allowed: number}>}
 */
export async function assertCanStart({
  userId = null,
  guestSessionId = null,
  requested,
}) {
  const quota = await getExamQuota({ userId, guestSessionId });
  if (quota.unlimited) return { quota, allowed: requested };

  if (quota.remaining <= 0) {
    throw new QuotaExceededError(
      quota.isGuest
        ? "Бесплатный демо-доступ исчерпан: 20 вопросов пройдено. Зарегистрируйтесь, чтобы продолжить."
        : "Месячная квота вопросов исчерпана. Она обновится в начале следующего месяца или сразу после подключения Exam Prep.",
      {
        feature: "examQuestions",
        isGuest: quota.isGuest,
        plan: quota.plan,
        limit: quota.limit,
        used: quota.used,
        // Что предлагать: гостю — регистрацию, остальным — аддон.
        upgrade: quota.isGuest ? "register" : "exam_addon",
        resetsAt: quota.periodEnd,
      },
    );
  }

  return { quota, allowed: Math.min(requested, quota.remaining) };
}

/**
 * Переносит гостевые попытки в аккаунт после регистрации или входа.
 *
 * Вызывается с sessionID той же сессии, в которой человек проходил демо:
 * express-session сохраняет id при логине (regenerate вызывается только
 * при явной ротации), поэтому связь не теряется.
 *
 * Расход при этом НЕ переносится: 20 демо-вопросов не должны съедать
 * месячную квоту — это подарок за регистрацию, а не аванс.
 *
 * @returns {Promise<number>} сколько попыток перенесено
 */
export async function claimGuestAttempts({ userId, guestSessionId }) {
  if (!userId || !guestSessionId) return 0;

  const res = await ExamAttempt.updateMany(
    { guestSessionId, userId: null },
    { $set: { userId, guestSessionId: null } },
  );
  return res.modifiedCount ?? 0;
}
