// server/modules/education/education-catalog/models/examProgram.model.js
//
// ExamProgram = одна экзаменационная программа: «резидентура в Турции (TUS)»,
// «SMLE, Саудовская Аравия», «аттестация терапевтов РФ», «внутренний
// HIPAA-тренинг клиники X».
//
// Проектные решения:
//   1. ГЛОБАЛЬНАЯ сущность — никакого clinicId в обязательных полях и
//      никакого tenantScoped-плагина. Аудитория модуля — врачи и резиденты
//      всего мира, а не сотрудники конкретной клиники. Приватные программы
//      клиники поддержаны опциональным ownerClinicId (null = публичная).
//   2. country + region + examType + authority дают полное покрытие «экзамены
//      по всем странам»: витрину можно фильтровать по любой оси.
//   3. blueprint — карта тем с весами в процентах. Это не украшение: по нему
//      собирается пробный экзамен и по нему считается «готовность» учащегося.
//   4. sourcePolicy на уровне программы фиксирует, откуда вообще берётся
//      контент этой программы (см. constants.js → SOURCE_KINDS).
//   5. НЕ PHI: здесь нет данных пациентов, шифрование не применяется.

import mongoose from "mongoose";
import {
  EXAM_REGIONS,
  EXAM_TYPES,
  EXAM_LANGUAGES,
  DEFAULT_EXAM_LANGUAGE,
  CATALOG_STATUSES,
  SOURCE_KINDS,
} from "../../constants.js";

const { Schema } = mongoose;

// ─── Раздел blueprint ─────────────────────────────────────────────────
// code — стабильный идентификатор темы внутри программы ("cardio",
// "cardio.arrhythmia"). Именно на него ссылается ExamItem.topicCode, поэтому
// код менять нельзя после публикации — только добавлять новые.
const blueprintSectionSchema = new Schema(
  {
    code: {
      type: String,
      required: true,
      trim: true,
      maxlength: 80,
    },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    // Родительская тема для двухуровневой карты (null = верхний уровень).
    parentCode: { type: String, default: null, trim: true, maxlength: 80 },
    // Доля темы в экзамене. Сумма весов верхнего уровня не должна
    // превышать 100 — проверяется в сервисе, не в схеме.
    weightPercent: { type: Number, required: true, min: 0, max: 100 },
  },
  { _id: false },
);

// ─── Локализованный заголовок/описание ────────────────────────────────
// Базовые title/description обязательны, переводы — по мере готовности.
const translationSchema = new Schema(
  {
    lang: { type: String, enum: EXAM_LANGUAGES, required: true },
    title: { type: String, trim: true, maxlength: 300 },
    description: { type: String, trim: true, maxlength: 4000 },
  },
  { _id: false },
);

const examProgramSchema = new Schema(
  {
    // ─── Идентификация ───
    // Человекочитаемый уникальный код: "tr-tus", "sa-smle", "ru-residency-therapy".
    code: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      maxlength: 100,
    },

    title: { type: String, required: true, trim: true, maxlength: 300 },
    description: { type: String, trim: true, maxlength: 4000, default: "" },
    translations: { type: [translationSchema], default: [] },

    // ─── География и тип ───
    // ISO 3166-1 alpha-2 в верхнем регистре, либо "INT" для международных.
    country: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
      minlength: 2,
      maxlength: 3,
      index: true,
    },
    region: { type: String, enum: EXAM_REGIONS, required: true, index: true },
    examType: { type: String, enum: EXAM_TYPES, required: true, index: true },

    // Орган, который проводит экзамен: "ÖSYM", "SCFHS", "DHA", "ECFMG".
    authority: { type: String, trim: true, maxlength: 200, default: null },

    // Специальность, если программа узкая ("cardiology"); null = общая.
    specialty: { type: String, trim: true, maxlength: 120, default: null },

    // Языки, на которых у программы есть вопросы.
    languages: {
      type: [String],
      enum: EXAM_LANGUAGES,
      default: [DEFAULT_EXAM_LANGUAGE],
    },

    // ─── Рубрикатор витрины ───
    // Категория/подкатегория из exam_categories, которую создаёт админ
    // (см. education-categories). null = тест не привязан ни к одной рубрике
    // и попадает в раздел «Другие тесты».
    categoryId: {
      type: Schema.Types.ObjectId,
      ref: "ExamCategory",
      default: null,
      index: true,
    },

    // ─── Деление на блоки ───
    // Большой экзамен (до 2000 вопросов) можно проходить не целиком, а
    // блоками по blockSize вопросов. null / 0 = деления нет, тест проходится
    // обычными режимами. Блок — это детерминированный срез опубликованных
    // вопросов, отсортированных по (createdAt, _id); см. attempt.service.
    blockSize: { type: Number, default: null, min: 1, max: 500 },

    // ─── Карта тем ───
    blueprint: { type: [blueprintSectionSchema], default: [] },

    // ─── Параметры пробного экзамена по умолчанию ───
    defaultQuestionCount: { type: Number, default: 60, min: 1, max: 500 },
    defaultDurationMinutes: { type: Number, default: 90, min: 1, max: 600 },
    passingScorePercent: { type: Number, default: 60, min: 0, max: 100 },

    // ─── Происхождение контента ───
    // "mixed" отдельного значения не имеет — используем самый строгий
    // источник из фактически используемых; на уровне вопроса источник
    // указывается точно (ExamItem.source).
    sourcePolicy: {
      type: String,
      enum: SOURCE_KINDS,
      default: "original",
    },
    // Публичная ссылка на официальный blueprint / методичку.
    sourceUrl: { type: String, trim: true, maxlength: 1000, default: null },
    // Пояснение по правам: чем именно разрешено пользоваться.
    licenseNote: { type: String, trim: true, maxlength: 2000, default: null },

    // ─── Владение и доступ ───
    // null = публичная программа проекта. Заполнено = приватная программа
    // конкретной клиники (внутреннее обучение персонала).
    ownerClinicId: {
      type: Schema.Types.ObjectId,
      ref: "Clinic",
      default: null,
      index: true,
    },
    // Доступна ли без подписки (демо-режим витрины).
    isFree: { type: Boolean, default: false },

    status: {
      type: String,
      enum: CATALOG_STATUSES,
      default: "draft",
      index: true,
    },
    publishedAt: { type: Date, default: null },

    // ─── Денормализованные счётчики (обновляются сервисом вопросов) ───
    publishedItemCount: { type: Number, default: 0 },

    // ─── Аудит ───
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  {
    timestamps: true,
    collection: "exam_programs",
  },
);

// ─── Индексы ───
// Основной сценарий витрины: «покажи опубликованные программы страны X».
examProgramSchema.index({ status: 1, country: 1, examType: 1 });
examProgramSchema.index({ status: 1, region: 1 });
examProgramSchema.index({ ownerClinicId: 1, status: 1 });
examProgramSchema.index({ title: "text", description: "text" });

const ExamProgram =
  mongoose.models.ExamProgram ||
  mongoose.model("ExamProgram", examProgramSchema, "exam_programs");

export default ExamProgram;
