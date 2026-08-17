// server/modules/clinic/clinic-core/services/clinicPlan.service.js
// ─────────────────────────────────────────────────────────────────────
//   Мост между тарифом, который клиника КУПИЛА, и тарифом, который у неё
//   ЗАПИСАН. Их до сих пор связывало ничто.
//
//   Два несовпадающих словаря:
//
//     прайс и PLAN_LIMITS  →  clinic_start | clinic | clinic_pro
//     поле Clinic.tier     →  starter | pro | medical_tourism | enterprise
//
//   Плюс третье обстоятельство: оплата (grantPlan) записывает тариф
//   ВЛАДЕЛЬЦУ, в user.subscriptionPlan, а не в документ клиники. То есть
//   клиника, купившая Clinic Business, имеет tier: "starter" — значение
//   по умолчанию, которое ей никто не менял.
//
//   Из-за этого разрыва ограничение «до 5 врачей» на тарифе за 99 $ не
//   работало вовсе: завести можно было сколько угодно.
//
//   Порядок определения — от достоверного к запасному:
//     1. тариф владельца, если он клинический (так выглядит оплата);
//     2. иначе — Clinic.tier, приведённый к клиническому плану;
//     3. иначе — предел не применяем (лучше пустить, чем ошибочно
//        заблокировать: клиника платит больше всех).
// ─────────────────────────────────────────────────────────────────────

import Clinic from "../models/clinic.model.js";
import User from "../../../../common/models/Auth/users.js";
import {
  resolveEffectivePlan,
  getLimit,
  PLAN_LIMITS,
} from "../../../../common/config/aiPlanLimits.js";

/**
 * Clinic.tier → ключ тарифа.
 *
 * medical_tourism в прайсе отсутствует: тариф заведён в модели, но не
 * продаётся. Приравниваем к Business — это ближайшее по смыслу, и
 * занижать лимит тому, у кого особые условия, хуже, чем завысить.
 */
const TIER_TO_PLAN = {
  starter: "clinic_start",
  pro: "clinic",
  medical_tourism: "clinic",
  enterprise: "clinic_pro",
};

const CLINIC_PLANS = new Set(["clinic_start", "clinic", "clinic_pro"]);

/**
 * Длительность пробного периода клиники.
 *
 * Месяц, а не три, как у врача. У врача пробный — это время понять
 * продукт в одиночку; у клиники решение принимает организация, и месяца
 * реальной работы отделения для него достаточно. При этом клиника
 * обходится нам дороже всех: 120 разборов на лимитах Start это около
 * $17 в месяц, то есть трёхмесячный пробный стоил бы как три платных.
 */
export const CLINIC_TRIAL_DAYS = 30;

/**
 * Состояние клиники по оплате. ТРИ значения, и они не взаимозаменяемы:
 *
 *   active  — владелец оплатил клинический тариф, срок идёт
 *   trial   — пробный период, работает на лимитах Start (или tier)
 *   frozen  — пробный кончился, оплаты нет: чтение есть, запись закрыта
 *
 * Бесплатного клинического уровня НЕТ намеренно. Клиника — организация с
 * бюджетом, и продукт для неё стоит денег; выдавать ей бессрочный
 * clinic_start (тариф за 99 $) даром значило бы, что неоплата ничего не
 * меняет. Раньше именно так и было: tier по умолчанию «starter»
 * отображался в clinic_start, и клиника получала его навсегда.
 *
 * @returns {Promise<{state: "active"|"trial"|"frozen", plan: string|null,
 *   until: Date|null}>}
 */
export async function resolveClinicAccess(clinicId) {
  const clinic = await Clinic.findById(clinicId)
    .select("ownerId tier trialEndsAt")
    .setOptions({ skipTenantScope: true })
    .lean();

  // Клиники нет — не наше дело отказывать: это 404 уровнем выше, а не
  // заморозка.
  if (!clinic) return { state: "active", plan: null, until: null };

  if (clinic.ownerId) {
    const owner = await User.findById(clinic.ownerId)
      .select("role subscriptionPlan subscriptionEndsAt trialEndsAt")
      .lean();
    if (owner) {
      // resolveEffectivePlan уже проверил срок: истёкший клинический
      // тариф сюда не вернётся.
      const ownerPlan = resolveEffectivePlan(owner);
      if (CLINIC_PLANS.has(ownerPlan)) {
        return {
          state: "active",
          plan: ownerPlan,
          until: owner.subscriptionEndsAt || null,
        };
      }
    }
  }

  const trialUntil = clinic.trialEndsAt ? new Date(clinic.trialEndsAt) : null;
  if (trialUntil && new Date() < trialUntil) {
    return {
      state: "trial",
      plan: TIER_TO_PLAN[clinic.tier] || "clinic_start",
      until: trialUntil,
    };
  }

  return { state: "frozen", plan: null, until: trialUntil };
}

/**
 * Действующий тарифный план клиники.
 *
 * @param {string|object} clinicId
 * @returns {Promise<string|null>} ключ плана или null, если определить нечем
 */
export async function resolveClinicPlan(clinicId) {
  // Один источник состояния на всё: иначе «какие лимиты» и «пускать ли
  // вообще» разъедутся, и клиника окажется заморожена с лимитами Start
  // либо наоборот.
  const { plan } = await resolveClinicAccess(clinicId);
  return plan;
}

/**
 * Предел числа врачей (сотрудников) для клиники.
 *
 * @returns {Promise<{plan: string, limit: number}|null>} null — предел
 *          неприменим: план не определён, фича не описана или безлимит.
 */
export async function clinicDoctorLimit(clinicId) {
  const plan = await resolveClinicPlan(clinicId);
  if (!plan || !PLAN_LIMITS[plan]) return null;

  const limit = getLimit(plan, "doctors");
  if (!limit || limit < 0) return null;

  return { plan, limit };
}

/**
 * Проверить, что тариф клиники включает фичу-флаг.
 *
 * Отличие от прав доступа: `can(analytics, read)` отвечает на вопрос
 * «этой роли положено?», а здесь — «этой клинике продано?». Обе проверки
 * нужны, и подменять одну другой нельзя: владелец клиники на Start имеет
 * роль с полным доступом, но аналитику ему не продавали — карточка Start
 * прямо говорит, что её нет.
 *
 * План не определён — не отказываем: клиника без владельца и без tier
 * это служебное состояние, а не попытка получить лишнее.
 *
 * @param {string|object} clinicId
 * @param {string} feature — ключ из PLAN_LIMITS ("analytics", …)
 * @returns {Promise<boolean>}
 */
export async function clinicHasFeature(clinicId, feature) {
  const { state, plan } = await resolveClinicAccess(clinicId);

  // Заморозка отбирает ПЛАТНЫЕ функции, но не доступ к медицинским
  // данным. Аналитика — витрина тарифа, а не карта пациента: держать её
  // открытой у неоплатившей клиники значит продавать то, что и так
  // работает. Чтение самих карт заморозка не трогает — это дело
  // clinicWriteGate, который закрывает только запись.
  if (state === "frozen") return false;

  // План не определился при живом доступе (клиника без владельца и без
  // tier — служебное состояние) — не отказываем: это не попытка получить
  // лишнее, а дыра в данных, и ломать из-за неё работающую клинику хуже.
  if (!plan || !PLAN_LIMITS[plan]) return true;

  return Boolean(PLAN_LIMITS[plan][feature]);
}

export default {
  resolveClinicAccess,
  resolveClinicPlan,
  clinicDoctorLimit,
  clinicHasFeature,
  CLINIC_TRIAL_DAYS,
};
