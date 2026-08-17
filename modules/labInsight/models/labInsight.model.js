// server/modules/labInsight/models/labInsight.model.js
// ─────────────────────────────────────────────────────────────────────
//   Разбор бланка анализов, сделанный ДЛЯ САМОГО ПАЦИЕНТА.
//
//   Это НЕ медицинская карта. Карту ведёт врач, она подписывается и
//   хранится семь лет. Здесь — фотография, которую человек принёс сам,
//   и объяснение, которое он попросил. Смешивать нельзя: запись,
//   созданная пациентом о себе, не может выглядеть как врачебная.
//
//   ФОТОГРАФИЯ НЕ ХРАНИТСЯ. Ни здесь, ни в R2, ни на диске. Бланк
//   содержит ФИО, дату рождения и номер карты; хранилище, которого нет,
//   невозможно скомпрометировать. Сохраняются только показатели, и
//   только те, что модель переписала с бланка.
//
//   ВЛАДЕЛЕЦ ОДИН. Разбор принадлежит пациенту и виден только ему.
//   Врач получает к нему доступ, если пациент сам поделился — отдельным
//   действием, которого пока нет. Молчаливый доступ клиники к тому, что
//   человек сфотографировал дома, был бы неожиданностью для него.
//
//   СРОК ЖИЗНИ. Год: разбор нужен, пока человек с ним разбирается и
//   несёт врачу. Через год это устаревшая копия документа, оригинал
//   которого у пациента на руках, и хранить её незачем.
// ─────────────────────────────────────────────────────────────────────

import mongoose from "mongoose";

const { Schema } = mongoose;

// Уровни из labFlags.service.js. Дублируются здесь как enum намеренно:
// база должна отвергать значение, которого сервис не производит.
export const INSIGHT_LEVELS = [
  "unknown",
  "normal",
  "borderline",
  "out",
  "far",
];

const ParameterSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    // Значение хранится СТРОКОЙ, как на бланке: «<0.5», «4,56», «12 *».
    // Число из него уже посчитано в value, но исходная запись важнее —
    // по ней человек сверяет разбор со своим бланком.
    rawValue: { type: String, required: true, trim: true },
    value: { type: Number, default: null },
    unit: { type: String, default: "", trim: true },
    refText: { type: String, default: "", trim: true },
    refMin: { type: Number, default: null },
    refMax: { type: Number, default: null },
    level: { type: String, enum: INSIGHT_LEVELS, default: "unknown" },
    direction: { type: String, enum: ["high", "low", null], default: null },
    // Насколько вышли за границу, в долях ширины интервала.
    ratio: { type: Number, default: null },
    // Объяснение от модели. Пустое — если показатель в модель не ходил
    // (уровень unknown: объяснять значение, не зная нормы, значит
    // домысливать норму).
    whatItIs: { type: String, default: "", trim: true },
    whatItMeans: { type: String, default: "", trim: true },
  },
  { _id: false },
);

const labInsightSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    labName: { type: String, default: "", trim: true },
    // Дата забора с бланка. Не подставляется «сегодня»: анализ мог быть
    // сдан месяц назад, и подмена даты сделала бы разбор недостоверным.
    collectedAt: { type: Date, default: null },

    parameters: { type: [ParameterSchema], default: [] },

    // Что не прочиталось. Показывается всегда и первым делом: молча
    // пропущенная строка бланка опаснее отказа — человек не станет
    // искать то, о чём не знает.
    unreadable: { type: [String], default: [] },

    overview: { type: String, default: "", trim: true },
    seeDoctor: { type: String, default: "", trim: true },

    // Происхождение: какой моделью и какой версией промптов получено.
    // Через полгода по этим полям видно, каким текстом сделан разбор.
    provenance: {
      readerModel: { type: String, default: null },
      readerPrompt: { type: String, default: null },
      explainerModel: { type: String, default: null },
      explainerPrompt: { type: String, default: null },
    },

    createdAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true, collection: "lab_insights" },
);

// Список открывают с конца — под это и индекс.
labInsightSchema.index({ userId: 1, createdAt: -1 });

// Год. Разбор нужен, пока человек с ним разбирается; дальше это
// устаревшая копия документа, оригинал которого у него на руках.
labInsightSchema.index({ createdAt: 1 }, { expireAfterSeconds: 365 * 86400 });

const LabInsight =
  mongoose.models.LabInsight ||
  mongoose.model("LabInsight", labInsightSchema, "lab_insights");

export default LabInsight;
