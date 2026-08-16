// server/modules/diagnostics/core/services/quota.service.js
//
// Ограничения на обращения к модели: сколько разборов и распознаваний может
// запустить один врач.
//
// ЗАЧЕМ. Каждый запуск разбора — это несколько обращений к внешней модели, и
// каждое стоит денег. До сих пор предела не было никакого: кнопку «Разобрать
// заново» можно нажимать подряд сколько угодно, а на странице дела она стоит
// рядом с результатом — то есть нажимать её будут.
//
// Опасность здесь не в злом умысле, а в обычном поведении: врач не получил
// нужного ответа, меняет формулировку вопроса и запускает снова, ещё раз, ещё.
// Десять нажатий за минуту — нормальная человеческая реакция, а не атака.
//
// ДВА РАЗНЫХ ПРЕДЕЛА, и они про разное:
//   в час  — защита от петли: заело кнопку, сорвался скрипт, врач в азарте;
//   в сутки — защита бюджета: столько разборов в день один человек físически
//             не осмыслит, значит дальше это уже не работа.
//
// Считаем по фактическим записям в базе (задания и события журнала), а не по
// счётчику в памяти: счётчик обнуляется при перезапуске процесса, а перезапуск
// у нас случается при каждом деплое — то есть предел обходился бы сам собой.
//
// Отказ всегда объясняет, КОГДА можно повторить. «Превышен лимит» без числа —
// это тупик, из которого врач не понимает, что делать.

import DiagnosticJob from "../models/diagnosticJob.model.js";
import User from "../../../../common/models/Auth/users.js";
import {
  resolveEffectivePlan,
  getLimit,
  PLAN_DISPLAY_NAMES,
} from "../../../../common/config/aiPlanLimits.js";
import { ValidationError } from "../../../../common/utils/errors.js";

/** Пределы. Вынесены в .env: у разных клиник разный аппетит и бюджет. */
export const LIMITS = {
  analyzePerHour: Number(process.env.DIAGNOSTICS_ANALYZE_PER_HOUR) || 20,
  analyzePerDay: Number(process.env.DIAGNOSTICS_ANALYZE_PER_DAY) || 60,
  extractPerHour: Number(process.env.DIAGNOSTICS_EXTRACT_PER_HOUR) || 40,
  extractPerDay: Number(process.env.DIAGNOSTICS_EXTRACT_PER_DAY) || 120,
};

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const MONTH_MS = 30 * DAY_MS;

// ─── Третий предел: месячная квота ТАРИФА ─────────────────────────────
//
// Пределы выше — про поведение (петля, азарт) и одинаковы для всех. Этот —
// про деньги, и у каждого тарифа он свой: aiAnalyses в aiPlanLimits.js.
//
// До сих пор связи между тарифом и разборами не было вовсе. Тарифная
// страница обещала 3 разбора на Lite и 60 на Growth, а фактически любой
// врач мог сделать 60 в сутки — то есть около 1800 в месяц, независимо от
// того, платит он 3 $ или 99 $. Цифры в прайсе были украшением: ни одна
// строка кода их не читала.
//
// Считаем по тем же фактическим записям, что и остальные пределы: счётчик
// в памяти обнулялся бы при каждом деплое.
//
// Окно скользящее (30 дней назад от «сейчас»), а не календарный месяц.
// Так проще и честнее: врач, зарегистрировавшийся 28-го, иначе получил бы
// полную месячную квоту за три дня.

/** План врача и его месячная квота разборов. null — квоту не применяем. */
async function planQuota(ownerId) {
  const user = await User.findById(ownerId)
    .select("role subscriptionPlan trialEndsAt")
    .lean();

  // Пользователя нет (служебный вызов, тест, удалённый аккаунт) — молча не
  // применяем тарифный предел. Часовой и суточный при этом работают, то
  // есть без защиты вызов не остаётся.
  if (!user) return null;

  const plan = resolveEffectivePlan(user);
  const limit = getLimit(plan, "aiAnalyses");

  // 0 — фича у плана не описана (пациентские планы), -1 — безлимит.
  // Ни то, ни другое не повод отказывать.
  if (!limit || limit < 0) return null;

  return { plan, limit };
}

/** Человеческое «через сколько можно». Минуты, а не миллисекунды. */
function humanWait(ms) {
  const minutes = Math.ceil(ms / 60000);
  if (minutes < 60) return `${minutes} мин`;
  const hours = Math.ceil(minutes / 60);
  return `${hours} ч`;
}

/**
 * Сколько заданий врач создал за период и когда освободится место.
 *
 * Считаем задания, а не запуски: один запуск создаёт задание на каждую
 * модальность, и именно они обращаются к модели. Иначе дело с восемью
 * направлениями стоило бы «одну единицу», как дело с одним.
 */
async function usageSince(ownerId, since) {
  const jobs = await DiagnosticJob.find({
    ownerId,
    createdAt: { $gte: since },
  })
    .select("createdAt")
    .sort({ createdAt: 1 })
    .lean();
  return jobs;
}

/**
 * Проверить, можно ли запускать разбор. Бросает ValidationError с понятным
 * текстом, если предел исчерпан.
 *
 * @param {string|object} ownerId
 * @param {number} [now]
 */
export async function assertAnalyzeAllowed(ownerId, now = Date.now()) {
  const dayJobs = await usageSince(ownerId, new Date(now - DAY_MS));
  const hourJobs = dayJobs.filter((j) => j.createdAt.getTime() >= now - HOUR_MS);

  if (hourJobs.length >= LIMITS.analyzePerHour) {
    const oldest = hourJobs[0].createdAt.getTime();
    throw new ValidationError(
      `Слишком много разборов за час (${hourJobs.length} из ${LIMITS.analyzePerHour}). ` +
        `Повторите через ${humanWait(oldest + HOUR_MS - now)}.`,
      { limit: "analyzePerHour", retryAfterMs: oldest + HOUR_MS - now },
    );
  }

  if (dayJobs.length >= LIMITS.analyzePerDay) {
    const oldest = dayJobs[0].createdAt.getTime();
    throw new ValidationError(
      `Исчерпан суточный лимит разборов (${LIMITS.analyzePerDay}). ` +
        `Повторите через ${humanWait(oldest + DAY_MS - now)}.`,
      { limit: "analyzePerDay", retryAfterMs: oldest + DAY_MS - now },
    );
  }

  // Месячная квота тарифа — последней: она дороже (лишний запрос к User и
  // выборка за 30 дней), а два предела выше отсекают основную массу.
  const quota = await planQuota(ownerId);
  if (!quota) return;

  const monthJobs = await usageSince(ownerId, new Date(now - MONTH_MS));
  if (monthJobs.length >= quota.limit) {
    const oldest = monthJobs[0].createdAt.getTime();
    const planName = PLAN_DISPLAY_NAMES[quota.plan] || quota.plan;
    throw new ValidationError(
      `Исчерпана месячная квота разборов тарифа ${planName} ` +
        `(${quota.limit}). Место освободится через ` +
        `${humanWait(oldest + MONTH_MS - now)}, либо перейдите на старший тариф.`,
      {
        limit: "analyzePerMonth",
        plan: quota.plan,
        planLimit: quota.limit,
        retryAfterMs: oldest + MONTH_MS - now,
      },
    );
  }
}

/**
 * Распознавание документов считаем по журналу аудита: своих записей у него
 * нет, а событие diagnostics.extract пишется на каждую отправку файла.
 *
 * @param {import("mongoose").Model} AuditModel
 */
export async function assertExtractAllowed(AuditModel, ownerId, now = Date.now()) {
  if (!AuditModel) return; // журнал недоступен — предел не проверяем, но и не врём

  const since = new Date(now - DAY_MS);
  const events = await AuditModel.find({
    "actor.userId": ownerId,
    action: "diagnostics.extract",
    createdAt: { $gte: since },
  })
    .select("createdAt")
    .sort({ createdAt: 1 })
    .lean();

  const hourEvents = events.filter((e) => e.createdAt.getTime() >= now - HOUR_MS);

  if (hourEvents.length >= LIMITS.extractPerHour) {
    const oldest = hourEvents[0].createdAt.getTime();
    throw new ValidationError(
      `Слишком много распознаваний за час (${hourEvents.length} из ${LIMITS.extractPerHour}). ` +
        `Повторите через ${humanWait(oldest + HOUR_MS - now)}.`,
      { limit: "extractPerHour", retryAfterMs: oldest + HOUR_MS - now },
    );
  }

  if (events.length >= LIMITS.extractPerDay) {
    const oldest = events[0].createdAt.getTime();
    throw new ValidationError(
      `Исчерпан суточный лимит распознаваний (${LIMITS.extractPerDay}). ` +
        `Повторите через ${humanWait(oldest + DAY_MS - now)}.`,
      { limit: "extractPerDay", retryAfterMs: oldest + DAY_MS - now },
    );
  }
}

/** Остаток лимитов — чтобы интерфейс мог показать его до нажатия. */
export async function analyzeQuotaLeft(ownerId, now = Date.now()) {
  const monthJobs = await usageSince(ownerId, new Date(now - MONTH_MS));
  const dayJobs = monthJobs.filter((j) => j.createdAt.getTime() >= now - DAY_MS);
  const hourJobs = dayJobs.filter((j) => j.createdAt.getTime() >= now - HOUR_MS);

  const quota = await planQuota(ownerId);

  return {
    hour: { used: hourJobs.length, limit: LIMITS.analyzePerHour },
    day: { used: dayJobs.length, limit: LIMITS.analyzePerDay },
    // month отсутствует, когда тарифная квота неприменима — интерфейсу
    // нужно уметь это отличать от «квота есть и она нулевая».
    ...(quota
      ? {
          month: {
            used: monthJobs.length,
            limit: quota.limit,
            plan: quota.plan,
          },
        }
      : {}),
  };
}
