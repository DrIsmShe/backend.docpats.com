// server/jobs/checkTrialReminders.js
// ─────────────────────────────────────────────────────────────────────
//   Cron-задача: проверка истекающего trial-периода у врачей
//   и отправка email-напоминаний.
//
//   Запускается ОДИН РАЗ В СУТКИ (по умолчанию в 09:00 утра по UTC).
//
//   Логика:
//   - Находит врачей у которых trialEndsAt в окне 30 / 7 / 1 день
//   - Проверяет флаг trialReminders.sent30d/sent7d/sent1d
//   - Если флаг false — шлёт email + ставит флаг
//   - Email на языке user.preferredLanguage
//
//   Подключение в bootstrap() / index.js:
//     import { scheduleTrialReminders } from "./jobs/checkTrialReminders.js";
//     scheduleTrialReminders();
// ─────────────────────────────────────────────────────────────────────

import cron from "node-cron";
import User from "../common/models/Auth/users.js";
import { sendEmail } from "../common/services/emailService.js";
import { getTrialReminderEmail } from "../common/templates/trialReminderEmails.js";

// ─── Утилита: формат даты DD.MM.YYYY для тела письма ───────────────
function formatTrialDate(date, lang = "ru") {
  if (!date) return "";
  const d = new Date(date);
  const map = {
    ru: "ru-RU",
    en: "en-GB",
    tr: "tr-TR",
    az: "az-AZ",
    ar: "ar-AE",
  };
  return d.toLocaleDateString(map[lang] || "ru-RU", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}

// ─── Утилита: расшифровка имени из User документа ──────────────────
// (использует существующий метод decryptFields если есть, иначе пустая строка)
async function getDoctorFirstName(userDoc) {
  try {
    if (typeof userDoc.decryptFields === "function") {
      const { firstName } = userDoc.decryptFields();
      return firstName || "";
    }
    return "";
  } catch {
    return "";
  }
}

// ─── Главная функция проверки и рассылки ───────────────────────────
export async function runTrialReminderCheck() {
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  Trial Reminder Check");
  console.log(`  ${new Date().toISOString()}`);
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  const now = new Date();

  // Окна — врачи у которых trialEndsAt находится в диапазоне:
  // 30d: между 30 и 31 днём от сейчас
  // 7d:  между 7 и 8 днями
  // 1d:  между 1 и 2 днями
  const day = 24 * 60 * 60 * 1000;

  const windows = [
    {
      type: "30d",
      flag: "trialReminders.sent30d",
      from: new Date(now.getTime() + 29 * day),
      to: new Date(now.getTime() + 31 * day),
    },
    {
      type: "7d",
      flag: "trialReminders.sent7d",
      from: new Date(now.getTime() + 6 * day),
      to: new Date(now.getTime() + 8 * day),
    },
    {
      type: "1d",
      flag: "trialReminders.sent1d",
      from: new Date(now.getTime()),
      to: new Date(now.getTime() + 2 * day),
    },
  ];

  let totalSent = 0;
  let totalErrors = 0;

  for (const w of windows) {
    // Находим врачей в окне для этого типа письма + флаг ещё не выставлен
    const query = {
      role: "doctor",
      isDeleted: { $ne: true },
      trialEndsAt: { $gte: w.from, $lte: w.to },
      [w.flag]: { $ne: true },
      // Не слать тем у кого уже есть платная подписка
      $or: [
        { subscriptionPlan: { $in: [null, "free", "doctor_free"] } },
        { subscriptionPlan: { $exists: false } },
      ],
    };

    const doctors = await User.find(query).select(
      "_id username preferredLanguage trialEndsAt emailEncrypted firstNameEncrypted",
    );

    console.log(`\n📨 [${w.type}] найдено врачей: ${doctors.length}`);

    for (const doc of doctors) {
      try {
        const lang = doc.preferredLanguage || "ru";
        const firstName = await getDoctorFirstName(doc);
        const trialEndsDate = formatTrialDate(doc.trialEndsAt, lang);

        const { subject, body } = getTrialReminderEmail({
          lang,
          type: w.type,
          firstName,
          trialEndsDate,
        });

        // Расшифровываем email (если есть метод)
        let emailPlain = null;
        if (typeof doc.decryptFields === "function") {
          emailPlain = doc.decryptFields().email;
        }

        if (!emailPlain) {
          console.warn(
            `  ⚠️ @${doc.username} — не удалось расшифровать email, пропускаю`,
          );
          continue;
        }

        await sendEmail(emailPlain, subject, body);

        // Помечаем что письмо отправлено
        await User.updateOne({ _id: doc._id }, { $set: { [w.flag]: true } });

        console.log(`  ✅ @${doc.username} (${lang}) → отправлено [${w.type}]`);
        totalSent++;
      } catch (err) {
        console.error(`  ❌ @${doc.username} — ошибка:`, err.message);
        totalErrors++;
      }
    }
  }

  console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`  Total sent: ${totalSent}`);
  console.log(`  Total errors: ${totalErrors}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  return { sent: totalSent, errors: totalErrors };
}

// ─── Регистрация cron — раз в сутки в 09:00 UTC ────────────────────
export function scheduleTrialReminders() {
  // "0 9 * * *" = каждый день в 09:00
  // Можно поменять на "0 6 * * *" (06:00 UTC = 10:00 Баку)
  cron.schedule("0 9 * * *", async () => {
    try {
      await runTrialReminderCheck();
    } catch (err) {
      console.error("❌ Trial reminder cron error:", err);
    }
  });

  console.log("⏰ Trial reminder cron активен (ежедневно в 09:00 UTC)");
}
