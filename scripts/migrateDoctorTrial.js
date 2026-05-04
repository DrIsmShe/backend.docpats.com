// server/scripts/migrateDoctorTrial.js
// ─────────────────────────────────────────────────────────────────────
//   ОДНОРАЗОВЫЙ MIGRATION SCRIPT
//
//   Запускается ОДИН РАЗ при выкатке новой тарифной модели.
//   Всем существующим врачам ставит trialEndsAt = today + 6 месяцев.
//
//   Запуск из server/ директории:
//     node scripts/migrateDoctorTrial.js
//
//   Безопасный — повторный запуск не перезапишет уже выставленный
//   trialEndsAt у тех кто его уже получил.
// ─────────────────────────────────────────────────────────────────────

import mongoose from "mongoose";
import dotenv from "dotenv";
import User from "../common/models/Auth/users.js";
import { DOCTOR_TRIAL_DAYS } from "../common/config/aiPlanLimits.js";

dotenv.config();

async function run() {
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("  Doctor Trial Migration");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  // Подбираем переменную с URI — у разных проектов она называется по-разному
  const MONGO_URI =
    process.env.MONGO_URI ||
    process.env.MONGODB_URI ||
    process.env.DATABASE_URL ||
    process.env.MONGO_URL;

  if (!MONGO_URI) {
    console.error(
      "❌ Не найдена переменная окружения с подключением к Mongo.\n" +
        "   Ожидается одна из: MONGO_URI, MONGODB_URI, DATABASE_URL, MONGO_URL\n" +
        "   Проверь файл .env",
    );
    process.exit(1);
  }

  await mongoose.connect(MONGO_URI);
  console.log("✅ Connected to MongoDB");

  const trialEndsAt = new Date(
    Date.now() + DOCTOR_TRIAL_DAYS * 24 * 60 * 60 * 1000,
  );

  // Находим всех врачей у которых ещё не проставлен trialEndsAt
  const doctorsToMigrate = await User.find({
    role: "doctor",
    $or: [{ trialEndsAt: null }, { trialEndsAt: { $exists: false } }],
  })
    .select("_id username createdAt")
    .lean();

  console.log(`\n📊 Найдено врачей для миграции: ${doctorsToMigrate.length}`);
  console.log(
    `📅 Trial будет действовать до: ${trialEndsAt.toLocaleDateString("ru-RU")} (${trialEndsAt.toISOString()})`,
  );

  if (doctorsToMigrate.length === 0) {
    console.log("\nНичего не делаю — всем врачам уже выставлен trialEndsAt.");
    await mongoose.disconnect();
    console.log("\n✅ Готово.");
    return;
  }

  // Безопасная пакетная update
  const result = await User.updateMany(
    {
      role: "doctor",
      $or: [{ trialEndsAt: null }, { trialEndsAt: { $exists: false } }],
    },
    {
      $set: { trialEndsAt },
    },
  );

  console.log(`\n✅ Обновлено: ${result.modifiedCount} врачей`);
  console.log(
    `   Все они получили trial до: ${trialEndsAt.toLocaleDateString("ru-RU")}`,
  );

  // Список первых 10 для проверки
  if (doctorsToMigrate.length > 0) {
    console.log("\nПервые 10 затронутых врачей:");
    doctorsToMigrate.slice(0, 10).forEach((d, i) => {
      const created =
        d.createdAt instanceof Date
          ? d.createdAt.toLocaleDateString("ru-RU")
          : "?";
      console.log(
        `  ${i + 1}. @${d.username || "(no-username)"} — зарегистрирован ${created}`,
      );
    });
  }

  await mongoose.disconnect();
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("✅ Миграция завершена успешно");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
}

run().catch((err) => {
  console.error("\n❌ Ошибка миграции:", err);
  process.exit(1);
});
