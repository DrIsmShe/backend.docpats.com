// server/modules/surgery/simulationQuota.service.js
//
// Месячная квота AI-симуляций результата операции.
//
// Симуляция — самая дорогая функция платформы в пересчёте на действие: один
// запуск это n обращений к модели изображений, и на gpt-image-2 при
// quality=high четыре варианта стоят около $0.66. Разбор анализов для
// сравнения — $0.09, вызов текстовой модели — центы. Без потолка врач,
// нажимающий «Сгенерировать» подряд, расходует свою годовую подписку за
// вечер, и платформа этого даже не замечает.
//
// ОКНО СКОЛЬЗЯЩЕЕ — 30 дней назад от «сейчас», как у разборов анализов и
// минут видео. Календарный месяц заставлял бы ждать первого числа: врач,
// начавший работу 28-го, получил бы полную квоту на три дня.
//
// СЧИТАЕМ ТОЛЬКО УСПЕШНЫЕ. Отказ по маске, пустому счёту или контент-политике
// денег не стоит, и списывать за него квоту — значит наказывать врача за наши
// же ошибки. Оплачена ровно та симуляция, что дошла до status "done".

import Simulation from "./simulation.model.js";
import User from "../../common/models/Auth/users.js";
import {
  resolveEffectivePlan,
  getLimit,
  PLAN_DISPLAY_NAMES,
} from "../../common/config/aiPlanLimits.js";
import { ValidationError } from "../../common/utils/errors.js";

const MONTH_MS = 30 * 24 * 60 * 60 * 1000;
const FEATURE = "aiSimulations";

/** Сколько симуляций сделано за последние 30 дней. */
export async function usedInWindow(surgeonId, now = Date.now()) {
  return Simulation.countDocuments({
    surgeonId,
    status: "done",
    createdAt: { $gte: new Date(now - MONTH_MS) },
  });
}

/**
 * План врача и его предел.
 *
 * ВНИМАНИЕ НА УМОЛЧАНИЕ. У прочих фич отсутствие ключа в тарифе означает
 * «ограничение неприменимо» — для симуляции это был бы открытый счёт по
 * $0.66 за нажатие. Здесь наоборот: нет ключа или ноль — функции на тарифе
 * нет. Безлимит только явный, через -1.
 */
async function planQuota(surgeonId) {
  const user = await User.findById(surgeonId)
    .select("role subscriptionPlan subscriptionEndsAt trialEndsAt")
    .lean();
  if (!user) return { plan: "unknown", limit: 0 };

  const plan = resolveEffectivePlan(user);
  const limit = getLimit(plan, FEATURE);

  if (limit < 0) return null; // явный безлимит
  return { plan, limit: limit || 0 };
}

/**
 * Проверить квоту ДО обращения к модели.
 *
 * Порядок принципиален: отказ, за который мы уже заплатили генерацию, —
 * худший вид отказа, и повторять его можно бесконечно.
 */
export async function assertSimulationAllowed(surgeonId, now = Date.now()) {
  const quota = await planQuota(surgeonId);
  if (!quota) return null; // безлимит

  const planName = PLAN_DISPLAY_NAMES[quota.plan] || quota.plan;

  if (quota.limit === 0) {
    throw new ValidationError(
      `AI-симуляция результата операции не входит в тариф ${planName}.` +
        " Она доступна начиная с платных врачебных планов.",
      { feature: FEATURE, plan: quota.plan, limit: 0, used: 0 },
    );
  }

  const used = await usedInWindow(surgeonId, now);
  if (used < quota.limit) return { ...quota, used };

  throw new ValidationError(
    `Симуляции на тарифе ${planName} закончились: ${used} из ${quota.limit}` +
      " за 30 дней. Квота восстанавливается постепенно — по мере того, как" +
      " прошлые симуляции выходят за окно.",
    { feature: FEATURE, plan: quota.plan, limit: quota.limit, used },
  );
}

/** Остаток — для интерфейса. */
export async function simulationQuotaLeft(surgeonId, now = Date.now()) {
  const quota = await planQuota(surgeonId);
  if (!quota) return { unlimited: true, used: 0, limit: null, left: null };

  const used = await usedInWindow(surgeonId, now);
  return {
    unlimited: false,
    plan: quota.plan,
    limit: quota.limit,
    used,
    left: Math.max(0, quota.limit - used),
  };
}

export default {
  assertSimulationAllowed,
  simulationQuotaLeft,
  usedInWindow,
};
