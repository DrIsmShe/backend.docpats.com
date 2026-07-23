// server/modules/payments/services/subscription.service.js
// ─────────────────────────────────────────────────────────────────────
//   Бизнес-логика подписок: валидация плана под роль, расчёт цены и даты
//   окончания, активация плана на модели User.
//
//   Источник цен/планов — common/config/aiPlanLimits.js (единый источник
//   правды). Здесь мы НЕ дублируем цены, а читаем их оттуда.
// ─────────────────────────────────────────────────────────────────────

import {
  PLAN_PRICES,
  EXAM_ADDONS,
  EXAM_ADDON_PRICES,
} from "../../../common/config/aiPlanLimits.js";

/**
 * Аддон «Подготовка к экзаменам» покупается по тому же маршруту, что и
 * подписка, но кладётся в другое поле: это не смена плана, а надстройка
 * над ним. Человек на бесплатном patient_free может купить Exam Prep и
 * остаться на patient_free.
 */
export function isExamAddon(planKey) {
  return Boolean(EXAM_ADDONS[planKey]);
}

// Аддон доступен любой роли: он про подготовку к экзаменам, а не про
// врачебный инструментарий — его одинаково покупают студент, резидент и
// практикующий врач.
const ADDON_ALLOWED_ROLES = ["patient", "user", "doctor", "admin"];

// Какие роли имеют право покупать какой план.
const PLAN_ALLOWED_ROLES = {
  patient_std: ["patient", "user"],
  patient_pro: ["patient", "user"],
  doctor_basic: ["doctor"],
  doctor_super: ["doctor"],
  doctor_pro: ["doctor"],
  clinic_start: ["doctor"],
  clinic: ["doctor"],
  clinic_pro: ["doctor"],
};

/**
 * Проверяет, что план существует, у него есть цена и роль юзера вправе
 * его покупать. Бросает Error с понятным сообщением, если нет.
 */
export function assertPlanAllowed(planKey, period, role) {
  if (period !== "monthly" && period !== "yearly") {
    throw new Error(`Invalid period: ${period} (expected monthly|yearly)`);
  }

  if (isExamAddon(planKey)) {
    if (!ADDON_ALLOWED_ROLES.includes(role)) {
      throw new Error(`Role "${role}" cannot purchase addon "${planKey}"`);
    }
    return;
  }

  if (!PLAN_PRICES[planKey]) {
    throw new Error(`Unknown or non-purchasable plan: ${planKey}`);
  }
  const allowed = PLAN_ALLOWED_ROLES[planKey];
  if (!allowed || !allowed.includes(role)) {
    throw new Error(`Role "${role}" cannot purchase plan "${planKey}"`);
  }
}

/**
 * Цена плана в USD за выбранный период.
 */
export function getPlanAmount(planKey, period) {
  const price = isExamAddon(planKey)
    ? EXAM_ADDON_PRICES[planKey]
    : PLAN_PRICES[planKey];
  if (!price) return 0;
  return price[period] || 0;
}

/**
 * Считает дату окончания оплаченного периода. Если у юзера ещё активна
 * прошлая подписка — продлеваем от её конца (стекинг), иначе от now.
 */
export function computeSubscriptionEnd(period, currentEndsAt, now) {
  const base =
    currentEndsAt && new Date(currentEndsAt) > now
      ? new Date(currentEndsAt)
      : new Date(now);
  const end = new Date(base);
  if (period === "yearly") {
    end.setFullYear(end.getFullYear() + 1);
  } else {
    end.setMonth(end.getMonth() + 1);
  }
  return end;
}

/**
 * Дата окончания при выдаче на произвольное число месяцев.
 *
 * Отдельно от computeSubscriptionEnd: там период — monthly|yearly (так
 * устроены тарифы у провайдера), а ручная выдача оперирует месяцами,
 * потому что «на три месяца в качестве компенсации» — обычный случай,
 * а «на треть года» — нет. Стекинг тот же: продлеваем от конца, если
 * текущий срок ещё не истёк.
 */
export function computeEndFromMonths(months, currentEndsAt, now) {
  const base =
    currentEndsAt && new Date(currentEndsAt) > now
      ? new Date(currentEndsAt)
      : new Date(now);
  const end = new Date(base);
  end.setMonth(end.getMonth() + months);
  return end;
}

/**
 * Выдать тариф или аддон вручную, без оплаты через провайдера.
 *
 * Для продаж мимо сайта (перевод, счёт юрлицу), промо, партнёрских
 * доступов и компенсаций. Нужна и после запуска эквайринга — это не
 * временная мера на период закрытой кассы.
 *
 * Проверку «какая роль что может купить» сохраняем: она защищает не от
 * админа, а от опечатки — клинический план пациенту не даст ничего,
 * кроме путаницы в отчётах.
 *
 * @param {Object} user   — документ User (mongoose)
 * @param {Object} opts   — { planKey, months, now }
 */
export async function grantPlan(user, { planKey, months = 1, now = new Date() }) {
  const count = Number(months);
  if (!Number.isInteger(count) || count < 1 || count > 36) {
    throw new Error("months must be an integer between 1 and 36");
  }

  // Период здесь формальность (проверка ждёт monthly|yearly), реальный
  // срок считается из months.
  assertPlanAllowed(planKey, "monthly", user.role);

  if (isExamAddon(planKey)) {
    user.examAddon = planKey;
    user.examAddonEndsAt = computeEndFromMonths(
      count,
      user.examAddonEndsAt,
      now,
    );
    await user.save({ validateModifiedOnly: true });
    return {
      examAddon: user.examAddon,
      examAddonEndsAt: user.examAddonEndsAt,
    };
  }

  user.subscriptionPlan = planKey;
  user.subscriptionEndsAt = computeEndFromMonths(
    count,
    user.subscriptionEndsAt,
    now,
  );
  await user.save({ validateModifiedOnly: true });

  return {
    subscriptionPlan: user.subscriptionPlan,
    subscriptionEndsAt: user.subscriptionEndsAt,
  };
}

/**
 * Активирует подписку на модели User после успешной оплаты.
 * Вызывается из webhook (боевые провайдеры) или из mock-confirm.
 *
 * @param {Object} user  — документ User (mongoose)
 * @param {Object} opts  — { planKey, period, provider, providerRef, now }
 * @returns {Object} краткая сводка активной подписки
 */
export async function activateSubscription(user, opts) {
  const { planKey, period } = opts;
  const now = opts.now instanceof Date ? opts.now : new Date();

  assertPlanAllowed(planKey, period, user.role);

  // Аддон не трогает основной план — у него своё поле и свой срок.
  // Стекинг тот же: докупка до истечения продлевает от конца, а не
  // обнуляет остаток.
  if (isExamAddon(planKey)) {
    user.examAddon = planKey;
    user.examAddonEndsAt = computeSubscriptionEnd(
      period,
      user.examAddonEndsAt,
      now,
    );
    user.paymentLastChargedAt = now;
    await user.save({ validateModifiedOnly: true });

    return {
      examAddon: user.examAddon,
      examAddonEndsAt: user.examAddonEndsAt,
      subscriptionPlan: user.subscriptionPlan ?? null,
    };
  }

  user.subscriptionPlan = planKey;
  user.subscriptionPeriod = period;
  user.subscriptionEndsAt = computeSubscriptionEnd(
    period,
    user.subscriptionEndsAt,
    now,
  );
  user.paymentLastChargedAt = now;

  await user.save({ validateModifiedOnly: true });

  return {
    subscriptionPlan: user.subscriptionPlan,
    subscriptionPeriod: user.subscriptionPeriod,
    subscriptionEndsAt: user.subscriptionEndsAt,
  };
}
