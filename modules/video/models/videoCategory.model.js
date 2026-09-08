// server/modules/video/models/videoCategory.model.js
//
// Раздел витрины: «Объяснения», «Разборы снимков», «Подготовка к операции» —
// то, что зритель видит чипсами и в боковом меню.
//
// ПОЧЕМУ ОТДЕЛЬНАЯ СУЩНОСТЬ, А НЕ ПЕРЕЧИСЛЕНИЕ В КОДЕ. Разделы витрины —
// решение владельца площадки, а не разработчика: сегодня их четыре, завтра
// понадобится «Реабилитация» или «Для родителей». Список в enum означает,
// что каждое такое решение упирается в выкатку кода.
//
// ЭТО НЕ ЗАМЕНА ПОЛЮ kind. Вид ролика (kind) — техническая природа записи:
// разбор снимка, итог консультации, запись приёма; на него завязаны правила
// PHI и машинная сборка, и менять его из админки нельзя. Раздел — витринная
// полка, куда ролик кладут руками. Одно про содержание, другое про показ.
//
// НАЗВАНИЯ НА ПЯТИ ЯЗЫКАХ, но обязателен только русский: заставлять
// заводить пять переводов ради одной полки — верный способ получить полки
// с названиями вида «Реабилитация Reabilitasiya Rehabilitasyon».

import mongoose from "mongoose";

const LOCALES = ["ru", "en", "az", "tr", "ar"];

const titleSchema = new mongoose.Schema(
  {
    ru: { type: String, trim: true, required: true, maxlength: 80 },
    en: { type: String, trim: true, default: "", maxlength: 80 },
    az: { type: String, trim: true, default: "", maxlength: 80 },
    tr: { type: String, trim: true, default: "", maxlength: 80 },
    ar: { type: String, trim: true, default: "", maxlength: 80 },
  },
  { _id: false },
);

const videoCategorySchema = new mongoose.Schema(
  {
    /* Ключ для адреса и фильтра. Латиницей: он попадает в строку запроса,
       и кириллица там превращается в нечитаемый процентный код. */
    slug: {
      type: String,
      trim: true,
      required: true,
      unique: true,
      lowercase: true,
      match: [/^[a-z0-9-]{2,40}$/, "Ключ раздела — латиница, цифры и дефис"],
    },
    title: { type: titleSchema, required: true },
    /* Порядок в меню. Дробные значения допустимы намеренно: вставить полку
       между второй и третьей, не перенумеровывая остальные. */
    order: { type: Number, default: 100 },
    active: { type: Boolean, default: true, index: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, default: null },
  },
  { timestamps: true },
);

videoCategorySchema.index({ active: 1, order: 1 });

/** Название на нужном языке с откатом на русский. */
videoCategorySchema.methods.titleFor = function titleFor(lang) {
  const t = this.title || {};
  return (LOCALES.includes(lang) && t[lang]) || t.ru || this.slug;
};

const VideoCategory =
  mongoose.models.VideoCategory ||
  mongoose.model("VideoCategory", videoCategorySchema);

export const CATEGORY_LOCALES = LOCALES;
export default VideoCategory;
