// __tests__/payments/subscriptionExpiry.test.js
//
// Подписка заканчивается.
//
// До этой правки не заканчивалась НИКОГДА: grantPlan записывал срок в
// subscriptionEndsAt, и ни одна строка его не читала. Клиника, заплатившая
// за один месяц Clinic Business, пользовалась им бессрочно. При этом аддон
// экзаменов истекал правильно — то есть за 7 $ срок соблюдался, а за 499 $
// нет.
//
// Проверяем именно resolveEffectivePlan: это единственная функция, через
// которую весь код узнаёт тариф человека.

import { describe, it, expect } from "vitest";
import { resolveEffectivePlan } from "../../common/config/aiPlanLimits.js";

const DAY = 24 * 60 * 60 * 1000;
const ago = (d) => new Date(Date.now() - d * DAY);
const ahead = (d) => new Date(Date.now() + d * DAY);

/** Врач с истёкшим пробным периодом: иначе пробный перекроет тариф. */
const doctor = (over = {}) => ({
  role: "doctor",
  trialEndsAt: ago(1),
  ...over,
});

const patient = (over = {}) => ({ role: "patient", ...over });

describe("срок действия платной подписки", () => {
  it("действующая подписка работает", () => {
    expect(
      resolveEffectivePlan(
        doctor({ subscriptionPlan: "doctor_pro", subscriptionEndsAt: ahead(10) }),
      ),
    ).toBe("doctor_pro");
  });

  it("истёкшая подписка врача откатывается на БЕСПЛАТНЫЙ уровень", () => {
    // Раньше здесь стоял doctor_lite — платный тариф за 9 $. Врач,
    // переставший платить, продолжал бессрочно пользоваться тем, за что
    // другие платят, и неоплата не меняла ничего.
    expect(
      resolveEffectivePlan(
        doctor({ subscriptionPlan: "doctor_pro", subscriptionEndsAt: ago(1) }),
      ),
    ).toBe("doctor_free");
  });

  it("истёкшая подписка пациента откатывается на бесплатный", () => {
    expect(
      resolveEffectivePlan(
        patient({ subscriptionPlan: "patient_pro", subscriptionEndsAt: ago(1) }),
      ),
    ).toBe("patient_free");
  });

  it("подписка клиники истекает так же: 499 $ не дают вечного тарифа", () => {
    // Владелец — это пользователь с ролью doctor, поэтому истёкший
    // клинический тариф роняет ЕГО на бесплатный врачебный уровень.
    // Доступ самой клиники решается отдельно (resolveClinicAccess):
    // тариф владельца перестал быть клиническим — значит клиника уходит
    // в пробный период либо замораживается.
    expect(
      resolveEffectivePlan(
        doctor({ subscriptionPlan: "clinic_pro", subscriptionEndsAt: ago(1) }),
      ),
    ).toBe("doctor_free");
  });

  it("пустой срок трактуется как «неизвестен», а не как «истёк»", () => {
    // Выданные вручную и старые записи даты не имеют. Отключать их задним
    // числом нельзя — это живые оплаченные аккаунты.
    expect(
      resolveEffectivePlan(
        doctor({ subscriptionPlan: "doctor_super", subscriptionEndsAt: null }),
      ),
    ).toBe("doctor_super");
  });

  it("день окончания ещё наш: граница не отсекает оплаченные сутки", () => {
    const inAnHour = new Date(Date.now() + 60 * 60 * 1000);
    expect(
      resolveEffectivePlan(
        doctor({ subscriptionPlan: "doctor_super", subscriptionEndsAt: inAnHour }),
      ),
    ).toBe("doctor_super");
  });

  it("активный пробный период перекрывает истёкшую подписку", () => {
    // Врач оплатил, срок вышел, но пробный ещё идёт — отдаём пробный,
    // он щедрее Lite. Ухудшать без нужды нельзя.
    expect(
      resolveEffectivePlan({
        role: "doctor",
        trialEndsAt: ahead(5),
        subscriptionPlan: "doctor_pro",
        subscriptionEndsAt: ago(1),
      }),
    ).toBe("doctor_trial");
  });
});
