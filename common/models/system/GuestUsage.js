// common/models/system/GuestUsage.js
//
// Учёт бесплатных попыток для НЕвошедших посетителей.
//
// Зачем понадобилось: в aiPlanLimits гостю объявлена одна статья в месяц, и
// интерфейс честно показывал «0 из 1», но считать было нечем — проверка лимита
// для userId=null возвращала «использовано 0, можно» захардкоженно. То есть
// счётчик был надписью, а эндпоинт генерации, открытый всему интернету, тратил
// деньги без всякого потолка.
//
// ПОЧЕМУ НЕ ХРАНИМ IP. Адрес посетителя — персональные данные, и класть его
// рядом с медицинским содержимым незачем. Храним HMAC-отпечаток, как это уже
// сделано для телефонов и почты в модели пользователя: сравнивать хватает,
// восстановить адрес нельзя.
//
// ПОЧЕМУ MONGO, А НЕ REDIS. Redis в проекте настроен с maxRetriesPerRequest:
// null — недоступный Redis не отдаёт ошибку, а копит команду, и проверка лимита
// повисла бы вместо отказа. База и так обязана быть жива, чтобы приложение
// работало вообще.

import mongoose from "mongoose";

const guestUsageSchema = new mongoose.Schema(
  {
    // HMAC от адреса посетителя либо служебный ключ вроде "global".
    keyHash: { type: String, required: true, index: true },

    // Что расходуется: aiArticles, aiConsultations и так далее — те же имена,
    // что в aiPlanLimits, чтобы счётчик и лимит нельзя было развести.
    feature: { type: String, required: true },

    // Окно учёта: "2026-08" для месячных лимитов, "2026-08-12" для суточных.
    window: { type: String, required: true },

    count: { type: Number, default: 0 },

    // Запись живёт чуть дольше самого длинного окна и удаляется сама:
    // хранить отпечатки посетителей дольше нужного незачем.
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

guestUsageSchema.index({ keyHash: 1, feature: 1, window: 1 }, { unique: true });
guestUsageSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const GuestUsage =
  mongoose.models.GuestUsage || mongoose.model("GuestUsage", guestUsageSchema);

export default GuestUsage;
