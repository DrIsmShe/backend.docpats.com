// server/scripts/backfillClinicTrial.mjs
// ─────────────────────────────────────────────────────────────────────
//   Разовая миграция: пробный период существующим клиникам.
//
//   ЗАЧЕМ. До появления trialEndsAt клиника получала clinic_start
//   бессрочно (tier по умолчанию «starter»). После деплоя пустой
//   trialEndsAt означает «пробный не начинался», то есть заморозку — и
//   клиника, работавшая вчера, наутро не смогла бы завести пациента.
//
//   Отсчёт ведём от СЕГОДНЯ, а не от даты создания клиники: клиника,
//   заведённая полгода назад, не должна расплачиваться за то, что
//   правило появилось позже неё. Это не подарок, а срок на решение.
//
//   Запуск (на сервере, из каталога backend):
//     node scripts/backfillClinicTrial.mjs          # показать, что будет
//     node scripts/backfillClinicTrial.mjs --apply  # применить
// ─────────────────────────────────────────────────────────────────────

import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

const APPLY = process.argv.includes("--apply");
const DAYS = Number(process.env.CLINIC_BACKFILL_TRIAL_DAYS || 30);

const uri = process.env.MONGO_URL || process.env.MONGO_URI;
if (!uri) {
  console.error("Нет строки подключения (MONGO_URL)");
  process.exit(1);
}

await mongoose.connect(uri);
const clinics = mongoose.connection.collection("clinics");

const until = new Date(Date.now() + DAYS * 24 * 60 * 60 * 1000);
const filter = { $or: [{ trialEndsAt: null }, { trialEndsAt: { $exists: false } }] };

const affected = await clinics
  .find(filter)
  .project({ name: 1, tier: 1, createdAt: 1 })
  .toArray();

console.log(`Клиник без пробного периода: ${affected.length}`);
for (const c of affected) console.log(`  • ${c.name} (tier=${c.tier})`);

if (!affected.length) {
  console.log("Менять нечего.");
} else if (!APPLY) {
  console.log(
    `\nБудет проставлено trialEndsAt = ${until.toISOString()} (+${DAYS} дн.)`,
  );
  console.log("Это пробный прогон. Повторите с --apply, чтобы применить.");
} else {
  const res = await clinics.updateMany(filter, { $set: { trialEndsAt: until } });
  console.log(
    `\nОбновлено: ${res.modifiedCount}. trialEndsAt = ${until.toISOString()}`,
  );
}

await mongoose.disconnect();
