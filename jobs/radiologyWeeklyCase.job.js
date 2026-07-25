// server/jobs/radiologyWeeklyCase.job.js
// ─────────────────────────────────────────────────────────────────────
//   Cron-задача: «Кейс недели» в «Диагностической арене».
//
//   Раз в неделю (понедельник 08:00 UTC) выбирает детерминированный кейс
//   недели и рассылает уведомление всем врачам — драйвит возврат в игру.
//
//   Использует общий notifyMany (in-app + web-push) и getWeeklyCase.
//   Дедуп в notification.service (userId, senderId, type, message) не даст
//   продублировать рассылку при повторном запуске в ту же неделю: текст
//   содержит название кейса, которое меняется раз в неделю.
//
//   Подключение в index.js:
//     import { scheduleWeeklyCaseNotification } from "./jobs/radiologyWeeklyCase.job.js";
//     scheduleWeeklyCaseNotification();
// ─────────────────────────────────────────────────────────────────────

import cron from "node-cron";
import User from "../common/models/Auth/users.js";
import { getWeeklyCase } from "../modules/radiology/game/game.service.js";
import { notifyMany } from "../modules/notifications/services/notification.service.js";

export async function runWeeklyCaseNotification() {
  const weekly = await getWeeklyCase();
  if (!weekly) {
    console.log("📢 Кейс недели: нет опубликованных кейсов — рассылка пропущена");
    return { sent: 0 };
  }

  const doctors = await User.find({ role: "doctor", isDeleted: { $ne: true } })
    .select("_id")
    .lean();
  const ids = doctors.map((d) => d._id);

  const sent = await notifyMany(ids, {
    type: "system_message",
    title: "Кейс недели · Диагностическая арена",
    message: `Новый разбор: «${weekly.title}». Пройдите и заработайте очки.`,
    link: `/radiology/cases/${weekly._id}`,
    icon: "activity",
    priority: "normal",
    meta: { feature: "radiology_weekly", caseId: String(weekly._id) },
  });

  console.log(`📢 Кейс недели «${weekly.title}» разослан врачам: ${sent}`);
  return { sent };
}

export function scheduleWeeklyCaseNotification() {
  // "0 8 * * 1" — каждый понедельник в 08:00 UTC.
  cron.schedule("0 8 * * 1", async () => {
    try {
      await runWeeklyCaseNotification();
    } catch (err) {
      console.error("❌ Weekly case cron error:", err);
    }
  });
  console.log("⏰ Кейс недели: cron активен (понедельник 08:00 UTC)");
}
