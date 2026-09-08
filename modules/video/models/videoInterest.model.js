// server/modules/video/models/videoInterest.model.js
//
// След зрителя: что он смотрел в открытой витрине.
//
// ЗАЧЕМ ОТДЕЛЬНАЯ КОЛЛЕКЦИЯ, А НЕ ЖУРНАЛ АУДИТА. Просмотры уже пишутся в
// hipaa_audit_logs, но это журнал ответственности: он append-only, живёт
// семь лет и читается при разборе инцидента. Строить на нём ленту значит
// перебирать миллионы записей ради подборки на главной — и заодно тащить
// в витрину данные, которым место в журнале.
//
// ЧТО СЮДА НЕ ПОПАДАЕТ — ГЛАВНОЕ ПРАВИЛО ЭТОГО ФАЙЛА. Только открытые
// ролики без PHI. Ролик с пациентом в кадре, объяснение перед операцией,
// итог приёма — всё это говорит о здоровье конкретного человека, и
// складывать такое в «историю интересов» нельзя: подборка «вам может быть
// интересно» на общем экране выдала бы диагноз тому, кто просто оказался
// рядом. Фильтр стоит в сервисе, а комментарий — здесь, чтобы его увидел
// тот, кто соберётся расширять запись.
//
// ЭТО НЕ ИСТОРИЯ ПРОСМОТРОВ ДЛЯ ЧЕЛОВЕКА. Записи существуют ради подбора
// роликов и никому, кроме самого зрителя, не показываются.

import mongoose from "mongoose";

const videoInterestSchema = new mongoose.Schema(
  {
    viewerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    videoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Video",
      required: true,
    },

    /* Признаки ролика, скопированные на момент просмотра. Копия, а не
       populate: подборка строится по десяткам записей, и join в неё
       превратил бы главную страницу в отчёт. Если раздел ролика потом
       поменяют, интерес зрителя от этого не изменится. */
    categoryId: { type: mongoose.Schema.Types.ObjectId, default: null },
    kind: { type: String, default: "" },
    lang: { type: String, default: "" },
    channelType: { type: String, enum: ["user", "clinic"], default: "user" },
    channelId: { type: mongoose.Schema.Types.ObjectId, default: null },

    /* Насколько досмотрел. Открыл и закрыл через пять секунд — это не
       интерес, а промах; доля отделяет одно от другого. */
    ratio: { type: Number, default: 0, min: 0, max: 1 },
    watchedAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

// Один ролик — одна запись на зрителя: пересмотр обновляет её, а не
// добавляет строку, иначе один настойчивый зритель перевесил бы все
// остальные интересы.
videoInterestSchema.index({ viewerId: 1, videoId: 1 }, { unique: true });

// Подбор читает последние записи зрителя.
videoInterestSchema.index({ viewerId: 1, watchedAt: -1 });

export default mongoose.models.VideoInterest ||
  mongoose.model("VideoInterest", videoInterestSchema);
