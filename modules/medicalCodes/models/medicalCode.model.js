// server/modules/medicalCodes/models/medicalCode.model.js
//
// Справочник медицинских кодов: болезни (МКБ-10) и вмешательства (ICHI).
//
// Одна коллекция на все системы кодирования, а не таблица на каждую. Причина:
// врач ищет одинаково («тонзиллит», «J35»), и разделение по коллекциям
// заставило бы искать в двух местах и склеивать результат в приложении.
// Систему различает поле `system`, оно же попадает в ответ, чтобы вызывающий
// код знал, что именно ему подставили.
//
// Справочник ГЛОБАЛЬНЫЙ: он одинаков для всех клиник и не содержит PHI,
// поэтому tenantScoped-плагин здесь НЕ применяется. Это единственная
// медицинская коллекция проекта без clinicId — и так и задумано: коды МКБ не
// принадлежат клинике.

import mongoose from "mongoose";

/**
 * Системы кодирования. Строки короткие и стабильные — они уезжают в записи
 * медкарты вместе с кодом, поэтому переименование потом будет стоить миграции.
 */
export const CODE_SYSTEMS = Object.freeze({
  // ── Болезни ──
  ICD10CM: "icd10cm", // американская клиническая модификация МКБ-10 (74k кодов, только en)
  ICD10WHO: "icd10who", // МКБ-10 ВОЗ (~14k), у неё есть официальные переводы

  // ── Вмешательства (операции, процедуры) ──
  //
  // ICD-9-CM Volume 3 — то, что доступно СЕЙЧАС: 3 882 кода, public domain,
  // выкачивается тем же публичным API, что и болезни. В США заменён на
  // ICD-10-PCS, но остаётся самой распространённой свободной номенклатурой
  // вмешательств и годится как международный ориентир.
  //
  // ICHI (ВОЗ) — то, что придёт на смену: моложе и точнее, но доступен только
  // через ICD API ВОЗ, а он требует регистрации. Заведён здесь заранее, чтобы
  // добавление не потребовало миграции: система кодирования — поле записи.
  ICD9CM_SG: "icd9cm_sg",
  ICHI: "ichi",
});

/** Системы, кодирующие вмешательства, а не болезни. */
export const INTERVENTION_SYSTEMS = Object.freeze([
  CODE_SYSTEMS.ICD9CM_SG,
  CODE_SYSTEMS.ICHI,
]);

export const SUPPORTED_LOCALES = Object.freeze(["ru", "en", "az", "tr", "ar"]);

/**
 * Названия кода на языках системы. Ключи фиксированы, потому что по ним
 * строятся индексы: динамическая Map не даст индексировать конкретный язык.
 *
 * `en` обязателен: это язык, на котором приходят исходные справочники, и
 * последний рубеж, если перевода нет.
 */
const titlesSchema = new mongoose.Schema(
  {
    en: { type: String, required: true, trim: true },
    ru: { type: String, trim: true, default: "" },
    az: { type: String, trim: true, default: "" },
    tr: { type: String, trim: true, default: "" },
    ar: { type: String, trim: true, default: "" },
  },
  { _id: false },
);

const medicalCodeSchema = new mongoose.Schema(
  {
    system: {
      type: String,
      required: true,
      enum: Object.values(CODE_SYSTEMS),
      index: true,
    },

    // Код в каноническом виде, как его пишет врач: "J35.01".
    code: { type: String, required: true, trim: true },

    // Тот же код без точек и в верхнем регистре: "J3501". Врач набирает
    // по-разному ("j35.01", "J3501"), и сравнивать нужно с чем-то одним.
    codeNormalized: { type: String, required: true, trim: true, index: true },

    titles: { type: titlesSchema, required: true },

    // Родительская рубрика ("J35") — чтобы показать врачу, из какой группы
    // код, и чтобы позже строить дерево. Заполняется импортёром.
    parentCode: { type: String, trim: true, default: "" },

    // Можно ли ставить диагноз именно этим кодом. В МКБ есть рубрики-заголовки
    // ("J35" — «Хронические болезни миндалин»), которые в карту ставить нельзя:
    // нужен конечный код ("J35.01"). Врача надо об этом предупреждать, а не
    // позволять подписать запись нерасчётной рубрикой.
    isBillable: { type: Boolean, default: true, index: true },

    // Версия/год выпуска справочника — источники обновляются ежегодно.
    version: { type: String, trim: true, default: "" },

    // Склеенная строка для полнотекстового поиска в обычном Mongo (fallback,
    // когда Atlas Search недоступен — см. codeSearch.service.js). Собирается в
    // pre-save и импортёром; вручную не заполнять.
    searchText: { type: String, default: "" },
  },
  {
    timestamps: true,
    collection: "medical_codes",
  },
);

// Один код внутри одной системы существует ровно один раз. Именно эта пара, а
// не сам код: "J35.01" есть и в icd10cm, и в icd10who, и это разные записи с
// разными названиями.
medicalCodeSchema.index({ system: 1, code: 1 }, { unique: true });

// Поиск по началу кода — самый частый путь: врач помнит рубрику и уточняет.
medicalCodeSchema.index({ system: 1, codeNormalized: 1 });

// Полнотекстовый индекс — fallback-стратегия поиска. Один индекс на коллекцию
// (ограничение Mongo), поэтому все языки склеены в searchText.
medicalCodeSchema.index({ searchText: "text" });

/**
 * Строит строку для полнотекстового поиска: код в обоих написаниях плюс все
 * заполненные названия. Отдельная функция, потому что импортёр пишет пачками
 * через bulkWrite, минуя pre-save хук.
 */
export function buildSearchText(doc) {
  const parts = [doc.code, doc.codeNormalized];
  for (const locale of SUPPORTED_LOCALES) {
    const title = doc.titles?.[locale];
    if (title) parts.push(title);
  }
  return parts.filter(Boolean).join(" ");
}

/** Нормализует код к виду для сравнения: "j35.01" → "J3501". */
export function normalizeCode(code) {
  return String(code || "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

medicalCodeSchema.pre("save", function (next) {
  if (this.code) this.codeNormalized = normalizeCode(this.code);
  this.searchText = buildSearchText(this);
  next();
});

// Регистрация с проверкой — модель импортируется и из API-процесса, и из
// скрипта импорта; повторный mongoose.model() бросил бы OverwriteModelError.
const MedicalCode =
  mongoose.models.MedicalCode ||
  mongoose.model("MedicalCode", medicalCodeSchema);

export default MedicalCode;
