// server/jobs/checkSubscriptionReminders.js
// ─────────────────────────────────────────────────────────────────────
//   Cron: напоминания о продлении ПЛАТНОЙ подписки и уведомление об
//   окончании.
//
//   ЗАЧЕМ. Напоминания существовали только для пробного периода
//   (checkTrialReminders). Платная подписка заканчивалась молча: человек
//   узнавал об этом, упершись в лимит бесплатного тарифа посреди работы.
//
//   ТРИ ПИСЬМА: за 7 дней, за 1 день и в день окончания. Тридцати дней
//   здесь нет намеренно — в отличие от полугодового пробного периода
//   месячная подписка за 30 дней ещё даже не началась.
//
//   ФЛАГИ СБРАСЫВАЮТСЯ ПРИ ПРОДЛЕНИИ. subscriptionReminders.forEndsAt
//   хранит срок, для которого выставлены флаги; когда grantPlan
//   продлевает подписку, дата меняется, флаги перестают соответствовать
//   и рассылка идёт заново. Без этого поля второе продление прошло бы
//   молча: флаги-то уже стоят.
//
//   Подключение в index.js:
//     import { scheduleSubscriptionReminders } from "./jobs/checkSubscriptionReminders.js";
//     scheduleSubscriptionReminders();
// ─────────────────────────────────────────────────────────────────────

import cron from "node-cron";
import User from "../common/models/Auth/users.js";
import { sendEmail } from "../modules/auth/services/emailService.js";
import { PLAN_DISPLAY_NAMES } from "../common/config/aiPlanLimits.js";

const DAY = 24 * 60 * 60 * 1000;

const PAID_PLANS = [
  "patient_std",
  "patient_pro", // снят с продажи, но у кого-то ещё действует
  "doctor_lite",
  "doctor_basic",
  "doctor_super",
  "doctor_pro",
  "clinic_start",
  "clinic",
  "clinic_pro",
];

function formatDate(date) {
  return new Date(date).toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

/** Тексты писем. Отдельной функцией — их правят чаще, чем логику. */
function buildLetter(kind, { planName, endsAt }) {
  const when = formatDate(endsAt);

  if (kind === "expired") {
    return {
      subject: `DocPats — подписка ${planName} закончилась`,
      text: [
        `Здравствуйте!`,
        ``,
        `Подписка ${planName} закончилась ${when}.`,
        ``,
        `Данные никуда не делись: история, документы и пациенты на месте,`,
        `и выгрузка по-прежнему доступна. Ограничено только добавление`,
        `нового — по лимитам бесплатного тарифа.`,
        ``,
        `Продлить: https://docpats.com/pricing`,
        ``,
        `— DocPats`,
      ].join("\n"),
    };
  }

  const left = kind === "7d" ? "неделю" : "один день";
  return {
    subject: `DocPats — подписка ${planName} заканчивается через ${left}`,
    text: [
      `Здравствуйте!`,
      ``,
      `Подписка ${planName} действует до ${when} — осталось ${left}.`,
      ``,
      `Если продлевать не планируете, ничего делать не нужно: списаний`,
      `без вашего участия не происходит. Аккаунт перейдёт на бесплатный`,
      `тариф, данные останутся при вас.`,
      ``,
      `Продлить: https://docpats.com/pricing`,
      ``,
      `— DocPats`,
    ].join("\n"),
  };
}

export async function runSubscriptionReminderCheck(now = new Date()) {
  const t = now.getTime();

  // Окна пересекаются с шагом суток, поэтому запуск раз в день не
  // пропускает и не задваивает: от повторов страхует флаг.
  const windows = [
    { kind: "7d", flag: "sent7d", from: new Date(t + 6 * DAY), to: new Date(t + 8 * DAY) },
    { kind: "1d", flag: "sent1d", from: new Date(t), to: new Date(t + 2 * DAY) },
    { kind: "expired", flag: "sentExpired", from: new Date(t - 2 * DAY), to: new Date(t) },
  ];

  let sent = 0;
  let failed = 0;

  for (const w of windows) {
    const users = await User.find({
      isDeleted: { $ne: true },
      subscriptionPlan: { $in: PAID_PLANS },
      subscriptionEndsAt: { $gte: w.from, $lte: w.to },
      $or: [
        { [`subscriptionReminders.${w.flag}`]: { $ne: true } },
        // Срок сменился — значит подписку продлили, и флаги относятся к
        // прошлому периоду.
        { "subscriptionReminders.forEndsAt": null },
        { $expr: { $ne: ["$subscriptionReminders.forEndsAt", "$subscriptionEndsAt"] } },
      ],
    })
      .select("emailEncrypted subscriptionPlan subscriptionEndsAt subscriptionReminders")
      .limit(500);

    for (const user of users) {
      let to = "";
      try {
        to = typeof user.decryptFields === "function"
          ? user.decryptFields().email || ""
          : "";
      } catch {
        /* расшифровать не удалось — письмо не отправить */
      }
      if (!to) continue;

      const planName =
        PLAN_DISPLAY_NAMES[user.subscriptionPlan] || user.subscriptionPlan;
      const letter = buildLetter(w.kind, {
        planName,
        endsAt: user.subscriptionEndsAt,
      });

      try {
        await sendEmail(to, letter.subject, letter.text);
        sent += 1;
      } catch (e) {
        failed += 1;
        console.error(`subscription-reminder: ${to} — ${e.message}`);
        // Флаг не ставим: пусть попробует завтра. Иначе одно падение SMTP
        // навсегда лишает человека предупреждения.
        continue;
      }

      // Флаги переставляем на текущий срок: если подписку продлят, дата
      // изменится и рассылка пойдёт заново.
      const prevFor = user.subscriptionReminders?.forEndsAt;
      const samePeriod =
        prevFor && new Date(prevFor).getTime() === new Date(user.subscriptionEndsAt).getTime();

      user.subscriptionReminders = {
        sent7d: samePeriod ? user.subscriptionReminders.sent7d : false,
        sent1d: samePeriod ? user.subscriptionReminders.sent1d : false,
        sentExpired: samePeriod ? user.subscriptionReminders.sentExpired : false,
        forEndsAt: user.subscriptionEndsAt,
      };
      user.subscriptionReminders[w.flag] = true;
      await user.save({ validateModifiedOnly: true });
    }
  }

  console.log(`📬 Напоминания о подписке: отправлено ${sent}, ошибок ${failed}`);
  return { sent, failed };
}

/** Раз в сутки в 09:30 UTC — через полчаса после пробных, чтобы не спорить за SMTP. */
export function scheduleSubscriptionReminders() {
  const expr = process.env.SUBSCRIPTION_REMINDERS_CRON || "30 9 * * *";
  if (process.env.SUBSCRIPTION_REMINDERS === "off") {
    console.log("📬 Напоминания о подписке выключены (SUBSCRIPTION_REMINDERS=off)");
    return null;
  }
  return cron.schedule(expr, () => {
    runSubscriptionReminderCheck().catch((e) =>
      console.error("subscription-reminder cron:", e.message),
    );
  });
}

export default { runSubscriptionReminderCheck, scheduleSubscriptionReminders };
