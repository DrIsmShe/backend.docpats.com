// jobs/autoCleanAppointments.js
import cron from "node-cron";
import mongoose from "mongoose";
import Appointment from "../common/models/Appointment/appointment.js";
import connectDB from "../common/config/db/mongodb.js";

let isRunning = false; // 🔒 защита от одновременного запуска

/** Форматирование времени для логов */
const fmt = (d) => (d instanceof Date ? d.toISOString() : String(d));

/**
 * 🧹 Автоочистка приёмов:
 * - Архивирует приёмы, закончившиеся более 7 дней назад (isArchived=false → true, archivedAt=now)
 * - Удаляет приёмы, которые были архивированы более 10 лет назад (по archivedAt)
 */
async function autoCleanAppointments() {
  if (isRunning) {
    console.log("⏸ [AutoClean] Пропуск: предыдущий цикл ещё выполняется");
    return;
  }
  isRunning = true;

  try {
    // ✅ Соединение с MongoDB
    if (mongoose.connection.readyState === 0) {
      console.log("⚙️ [AutoClean] Подключаюсь к MongoDB...");
      await connectDB();
      console.log("🟢 [AutoClean] MongoDB подключено.");
    } else {
      console.log("✅ [AutoClean] Используется активное соединение MongoDB.");
    }

    const now = new Date();

    // Архивировать приёмы старше 7 дней
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // Удалять приёмы, архивированные более 10 лет назад
    const tenYearsAgo = new Date(
      now.getTime() - 10 * 365 * 24 * 60 * 60 * 1000
    );

    console.log("🧹 [CRON] Запущена автоочистка приёмов:", fmt(now));
    console.log("   ↳ 7 дней назад (архивация):", fmt(sevenDaysAgo));
    console.log("   ↳ 10 лет назад (удаление):", fmt(tenYearsAgo));

    // 📊 Диагностика ДО
    const totalBefore = await Appointment.countDocuments();
    const toArchiveCount = await Appointment.countDocuments({
      isArchived: false,
      endsAt: { $lt: sevenDaysAgo },
    });
    const toDeleteCount = await Appointment.countDocuments({
      isArchived: true,
      archivedAt: { $lt: tenYearsAgo },
    });

    console.log(
      `📋 Всего: ${totalBefore} | К архиву (>7д): ${toArchiveCount} | К удалению (archivedAt >10лет): ${toDeleteCount}`
    );

    // 1️⃣ Архивация (не архивированы, закончились более 7 дней назад)
    const archived = await Appointment.updateMany(
      {
        isArchived: false,
        endsAt: { $lt: sevenDaysAgo },
      },
      { $set: { isArchived: true, archivedAt: now } }
    );

    // 2️⃣ Удаление (архивированы более 10 лет назад)
    const deleted = await Appointment.deleteMany({
      isArchived: true,
      archivedAt: { $lt: tenYearsAgo },
    });

    console.log(
      `✅ [AutoClean] Архивировано: ${archived.modifiedCount || 0}, Удалено: ${
        deleted.deletedCount || 0
      }`
    );

    const totalAfter = await Appointment.countDocuments();
    console.log(`📊 Осталось приёмов после очистки: ${totalAfter}`);
  } catch (error) {
    console.error("❌ [AutoClean] Ошибка автоочистки приёмов:", error);
  } finally {
    isRunning = false;
  }
}

// 🕓 Планировщик: каждый день в 03:00 (серверное время)
cron.schedule("0 3 * * *", () => {
  console.log("🕒 [CRON] Ежедневная автоочистка (03:00) запущена");
  autoCleanAppointments();
});

// 🚀 Первичный запуск через 15 секунд после старта приложения
setTimeout(() => {
  console.log("🚀 [AutoClean] Первичный запуск через 15 секунд...");
  autoCleanAppointments();
}, 15000);

export default autoCleanAppointments;
