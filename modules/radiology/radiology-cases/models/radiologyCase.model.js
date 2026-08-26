// server/modules/radiology/radiology-cases/models/radiologyCase.model.js
//
// RadiologyCase = один учебный кейс лучевой диагностики: одно исследование
// (стек анонимных срезов) + ВСТРОЕННЫЙ эталон эксперта (находки, их
// локализация, заключение). Кейс и исследование здесь 1:1, поэтому срезы
// хранятся прямо в кейсе, а не отдельной коллекцией.
//
// Проектные решения:
//   1. Координаты находок НОРМАЛИЗОВАНЫ к 0..1 — разметка не зависит от
//      разрешения показа (см. constants.js → FINDING_SHAPES).
//   2. Эталон (findings, impression) — «ключ ответа». Учащемуся он не
//      отдаётся до сдачи попытки: sanitize делает сервис, а не модель.
//   3. deidentified — снимок обязан быть анонимным. Публикация кейса без
//      подтверждённой деидентификации запрещена гейтом сервиса: это
//      HIPAA-платформа, PHI в пикселях/EXIF недопустимо.
//   4. Жизненный цикл draft→in_review→published — как у вопроса education:
//      наружу только через ревью человеком.

import mongoose from "mongoose";
import { aiReviewField, aiRevisionField } from "../../ai/aiReviewFields.js";
import { agentRunField } from "../../ai/agentRunFields.js";
import {
  MODALITIES,
  FINDING_SHAPES,
  SIGNIFICANCES,
  CASE_STATUSES,
  DIFFICULTIES,
  SOURCE_KINDS,
} from "../../constants.js";

const { Schema } = mongoose;

// Один срез/проекция исследования. Файл — анонимный PNG/JPEG в R2 (на
// первом этапе настоящий DICOM не парсим). pixelSpacingMm делает замеры
// осмысленными в миллиметрах, а не в пикселях.
const imageSchema = new Schema(
  {
    url: { type: String, required: true, trim: true, maxlength: 1000 },
    order: { type: Number, default: 0 },
    // Подпись проекции/среза: «PA», «Боковая», «Срез 12».
    label: { type: String, trim: true, maxlength: 120, default: "" },
    width: { type: Number, default: null }, // пиксели оригинала — для замеров
    height: { type: Number, default: null },
    pixelSpacingMm: { type: Number, default: null }, // мм на пиксель, если известно
  },
  { _id: false },
);

// Геометрия разметки. Хранится как свободный объект, форму валидирует zod
// на входе (по shape): point{x,y}, rect{x,y,w,h}, ellipse{cx,cy,rx,ry},
// polygon{points:[{x,y}]}. Всё в долях 0..1.
const geometrySchema = new Schema(
  {
    shape: { type: String, enum: FINDING_SHAPES, required: true },
    coords: { type: Schema.Types.Mixed, required: true },
  },
  { _id: false },
);

// Эталонная находка эксперта.
const findingSchema = new Schema(
  {
    // Стабильный ключ находки внутри кейса — на него ссылается разбор.
    key: { type: String, required: true, trim: true, maxlength: 40 },
    // Индекс кадра, на котором находка (0-based).
    imageIndex: { type: Number, required: true, min: 0 },
    // Ярлык из контролируемого словаря (lexicon.js).
    label: { type: String, required: true, trim: true, maxlength: 60 },
    significance: { type: String, enum: SIGNIFICANCES, default: "major" },
    geometry: { type: geometrySchema, required: true },
    // Обязательна ли находка к обнаружению (её пропуск штрафуется).
    required: { type: Boolean, default: true },
    // Почему это патология — показывается в разборе после сдачи.
    explanation: { type: String, trim: true, maxlength: 2000, default: "" },
  },
  { _id: false },
);

// План находок от ИИ: «что должно быть на снимке и где искать». Это НЕ
// эталон — координат здесь нет и быть не может, снимка в момент генерации
// ещё не существует. Автор загружает кадр и переносит находки из плана на
// холст, после чего они уходят в findings, а из плана исчезают.
//
// Раньше план жил только в состоянии формы и умирал при сохранении. Для
// кейсов, которые создаёт ночной автогенератор (jobs/radiologyDailyCases),
// это неприемлемо: между генерацией и приходом автора проходят часы, и без
// хранения плана автокейс приезжал бы к человеку пустым — с заключением, но
// без списка того, что на снимке должно быть.
const plannedFindingSchema = new Schema(
  {
    label: { type: String, required: true, trim: true, maxlength: 60 },
    significance: { type: String, enum: SIGNIFICANCES, default: "major" },
    // Где искать — словами: «правый верхний отдел», «базально слева».
    location: { type: String, trim: true, maxlength: 300, default: "" },
    explanation: { type: String, trim: true, maxlength: 2000, default: "" },
  },
  { _id: false },
);

// Эталонное заключение.
const impressionSchema = new Schema(
  {
    // Образцовый текст заключения (для разбора и как эталон ИИ-грейдинга).
    correctText: { type: String, trim: true, maxlength: 4000, default: "" },
    // Принятые ключи диагноза: любой из них засчитывается как верный.
    // Свободный набор автора, а не глобальный справочник (диагнозов слишком
    // много; словарём фиксируем только находки).
    diagnosisKeys: { type: [String], default: [] },
    // Человекочитаемые синонимы диагноза — помогают ИИ/эвристике распознать
    // верный ответ в свободном тексте.
    diagnosisSynonyms: { type: [String], default: [] },
  },
  { _id: false },
);

const sourceSchema = new Schema(
  {
    kind: { type: String, enum: SOURCE_KINDS, required: true },
    authority: { type: String, trim: true, maxlength: 300, default: null },
    url: { type: String, trim: true, maxlength: 1000, default: null },
    year: { type: Number, min: 1900, max: 2200, default: null },
    licenseNote: { type: String, trim: true, maxlength: 2000, default: null },
  },
  { _id: false },
);

const radiologyCaseSchema = new Schema(
  {
    modality: { type: String, enum: MODALITIES, required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 300 },
    // Клинический контекст (анамнез, жалобы) — виден учащемуся ДО ответа.
    clinicalContext: { type: String, trim: true, maxlength: 4000, default: "" },
    difficulty: {
      type: String,
      enum: DIFFICULTIES,
      default: "medium",
      index: true,
    },
    categoryId: {
      type: Schema.Types.ObjectId,
      ref: "ExamCategory",
      default: null,
      index: true,
    },
    tags: { type: [String], default: [] },

    // ─── Исследование ───
    images: { type: [imageSchema], default: [] },

    // ─── Эталон эксперта (ключ ответа — не отдаётся учащемуся до сдачи) ───
    findings: { type: [findingSchema], default: [] },
    impression: { type: impressionSchema, default: () => ({}) },

    // Чек-лист «что разметить», пока снимка нет. Учащемуся не отдаётся
    // никогда: sanitizeForLearner собирает ответ по белому списку полей.
    plannedFindings: { type: [plannedFindingSchema], default: [] },

    // ─── Происхождение и приватность ───
    source: { type: sourceSchema, required: true },
    // Подтверждение, что снимок деидентифицирован. Без true публикация
    // запрещена (assertPublishable в сервисе).
    deidentified: { type: Boolean, default: false },

    // ─── Ночная автогенерация (jobs/radiologyDailyCases.job.js) ───
    // Отдельное поле, а не только tags: по нему считается «сколько автокейсов
    // уже ждёт автора» (лимит очереди) и «какие темы уже разобраны» (чтобы
    // генератор не выдавал один и тот же пневмоторакс каждую ночь). Тег для
    // такого — слишком слабая гарантия: его правит человек в форме.
    autoGen: {
      isAuto: { type: Boolean, default: false, index: true },
      // Ключ темы из ai/dailyTopics.js — им же и дедуплицируются темы.
      topicKey: { type: String, trim: true, maxlength: 80, default: "" },
      generatedAt: { type: Date, default: null },
      model: { type: String, trim: true, maxlength: 120, default: "" },
    },

    // ГДЕ ИСКАТЬ СНИМОК ПОД ЭТОТ КЕЙС.
    //
    // Кейс придуман по ТЕМЕ, а не по снимку: изображения в момент генерации
    // не существует, и «ссылки на снимок, по которому сделан кейс», взяться
    // неоткуда. Именно на этом работа и вставала — текст готов, а кадра нет.
    //
    // Поэтому сразу после генерации ищем в сети учебные случаи по той же теме
    // и складываем ссылки СЮДА, в сам кейс. Автор открывает черновик и видит
    // кандидатов, а не пустое поле для URL.
    //
    // Ссылки, не файлы: скачать, проверить лицензию, убедиться, что находка
    // на кадре та самая, и деидентифицировать — работа человека.
    imageSources: {
      type: [
        {
          _id: false,
          url: { type: String, trim: true, maxlength: 500, default: "" },
          site: { type: String, trim: true, maxlength: 80, default: "" },
          title: { type: String, trim: true, maxlength: 300, default: "" },
          whatIsShown: { type: String, trim: true, maxlength: 500, default: "" },
          // Лицензия хранится строкой «как на странице»: приводить её к
          // справочнику значило бы решать за человека там, где ошибка стоит
          // претензии от правообладателя.
          license: { type: String, trim: true, maxlength: 200, default: "" },
          commercialUse: {
            type: String,
            enum: ["yes", "no", "unclear"],
            default: "unclear",
          },
          match: { type: String, enum: ["exact", "close", "partial"], default: "partial" },
          matchNote: { type: String, trim: true, maxlength: 300, default: "" },
        },
      ],
      default: [],
    },
    // Совет модели, что искать вручную, если находок мало.
    imageSearchAdvice: { type: String, trim: true, maxlength: 1000, default: "" },
    imageSearchAt: { type: Date, default: null },

    // ─── Редакторский цикл ───
    status: { type: String, enum: CASE_STATUSES, default: "draft", index: true },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    reviewedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    reviewedAt: { type: Date, default: null },
    rejectionReason: { type: String, trim: true, maxlength: 2000, default: null },
    publishedAt: { type: Date, default: null },

    // ─── Статистика для аналитики (заполняется при сдаче попыток) ───
    // Лимит времени зачётной попытки, секунды. null — берётся значение по
    // станции из attemptPolicy.DEFAULT_TIME_LIMIT_SEC. В тренировке лимита
    // нет вообще.
    timeLimitSec: { type: Number, default: null, min: 30, max: 7200 },

    // Типовой ответ чат-бота на этот кейс: нужен, чтобы заметить дословно
    // перенесённое заключение (integrity.service.js). Заполняется автором по
    // кнопке, не влияет на оценку.
    aiBaseline: {
      text: { type: String, default: "" },
      model: { type: String, default: "" },
      generatedAt: { type: Date, default: null },
    },

    // Сохранённая ИИ-рецензия второго прохода и отметки «разобрано».
    // Лежит в кейсе, а не в состоянии формы: гейт публикации опирается на
    // разбор замечаний, а состояние React живёт до перезагрузки страницы.
    ...aiReviewField(),

    // След цикла «правка → перепроверка» (ai/autoFix.js). Для лучевого кейса
    // он касается только текстовой части: разметку на кадре машина не трогает.
    ...aiRevisionField(),

    // Состояние фонового прогона агента (ai/agentRunFields.js).
    ...agentRunField(),

    stats: {
      attempts: { type: Number, default: 0 }, // все сдачи, включая тренировки
      avgScore: { type: Number, default: 0 }, // 0..1, ТОЛЬКО первые зачётные
      // Первые зачётные попытки: знаменатель avgScore. Средний балл по всем
      // сдачам подряд врал бы — повтор после разбора всегда высокий.
      countedAttempts: { type: Number, default: 0 },
      // Средняя длительность зачётной попытки: база для сигнала «сдал
      // подозрительно быстро».
      avgDurationMs: { type: Number, default: null },
    },
  },
  { timestamps: true, collection: "radiology_cases" },
);

radiologyCaseSchema.index({ status: 1, modality: 1, difficulty: 1 });
radiologyCaseSchema.index({ tags: 1 });

const RadiologyCase =
  mongoose.models.RadiologyCase ||
  mongoose.model("RadiologyCase", radiologyCaseSchema, "radiology_cases");

export default RadiologyCase;
