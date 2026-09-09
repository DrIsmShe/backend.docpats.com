// server/modules/feedback/models/feedback.model.js
//
// Обращение к разработчикам: пожелание, замечание, найденная ошибка.
//
// ЗАЧЕМ ОТДЕЛЬНАЯ СУЩНОСТЬ, А НЕ ПИСЬМО НА ПОЧТУ. Письмо теряется, на него
// отвечают из личного ящика, и через месяц никто не скажет, что человеку
// пообещали. У обращения есть состояние, переписка и итог — и оно
// показывается тому, кто его отправил, в его же кабинете.
//
// ПЕРЕПИСКА ЛЕЖИТ ВНУТРИ ДОКУМЕНТА. Обращение — это разговор из нескольких
// реплик, а не переписка на годы: отдельная коллекция сообщений дала бы
// лишний запрос на каждое открытие карточки и ничего не добавила. Предел
// на число реплик поставлен явно — тред, растущий бесконечно, однажды
// перестанет помещаться в документ.
//
// ТЕКСТ ОБРАЩЕНИЯ — ЭТО ЧУЖИЕ СЛОВА. Пациент, рассказывая об ошибке, может
// упомянуть свой диагноз: он вправе, а мы обязаны это учесть. Поэтому текст
// ограничен по длине, не индексируется для поиска и не попадает ни в
// уведомления, ни в аудит — только в карточку разбора.
//
// РОЛЬ АВТОРА — СНИМОК. Врач может уйти из клиники, пациент — стать
// сотрудником. Кто написал обращение, важно знать на момент, когда его
// написали, а не на момент, когда его читают.

import mongoose from "mongoose";

/* Виды обращений. Список короткий: длинный заставляет человека угадывать
   формулировку и бросать на первом же шаге. */
export const ВИДЫ = ["idea", "improvement", "bug", "question", "other"];

/* Состояния разбора. «planned» отделено от «in_progress» намеренно: между
   «мы согласны» и «мы делаем» иногда проходят месяцы, и человек имеет
   право видеть разницу. */
export const СОСТОЯНИЯ = [
  "new",
  "in_review",
  "planned",
  "in_progress",
  "done",
  "declined",
];

/* Закрытые состояния: дальше переписки не будет, и без объяснения
   закрывать нельзя. */
export const ЗАКРЫТЫЕ = ["done", "declined"];

export const ВАЖНОСТЬ = ["low", "normal", "high"];

/* Разделы продукта. Нужны, чтобы очередь разбора можно было разложить по
   ответственным, а не читать сплошным потоком. Ключи — те же, что в
   адресах: человек выбирает из списка, свободного ввода здесь нет. */
export const РАЗДЕЛЫ = [
  "account",
  "appointments",
  "chat",
  "video",
  "clinic",
  "patients",
  "documents",
  "ai",
  "billing",
  "mobile",
  "other",
];

const МАКС_РЕПЛИК = 100;

const репликаSchema = new mongoose.Schema(
  {
    /* Кто говорит. «system» — автоответ: он не подписан именем человека,
       и выдавать его за ответ администратора нечестно. */
    authorType: {
      type: String,
      enum: ["author", "admin", "system"],
      required: true,
    },
    authorId: { type: mongoose.Schema.Types.ObjectId, default: null },
    text: { type: String, trim: true, required: true, maxlength: 4000 },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true },
);

const feedbackSchema = new mongoose.Schema(
  {
    /* Автор. Сотрудник клиники входит без User — поэтому тип, а не одна
       ссылка: иначе обращения сотрудников оказались бы безымянными. */
    authorType: {
      type: String,
      enum: ["user", "employee"],
      required: true,
    },
    authorId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    /* Роль на момент обращения — снимок, см. заголовок файла. */
    authorRole: { type: String, trim: true, default: "" },
    clinicId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Clinic",
      default: null,
      index: true,
    },

    kind: { type: String, enum: ВИДЫ, required: true },
    area: { type: String, enum: РАЗДЕЛЫ, default: "other" },

    subject: { type: String, trim: true, required: true, maxlength: 140 },
    body: { type: String, trim: true, required: true, maxlength: 5000 },

    /* Язык автора: на нём приходят автоответы и уведомления. Хранится в
       обращении, а не берётся из профиля, — человек мог писать с другого
       языка интерфейса, и отвечать ему надо на том, на котором он писал. */
    locale: { type: String, trim: true, default: "ru", maxlength: 5 },

    /* Где это случилось. Для ошибки половина ответа содержится здесь:
       адрес страницы и браузер снимают большую часть переписки «а где
       именно?». Личных данных тут нет — это техническое окружение. */
    context: {
      url: { type: String, trim: true, default: "", maxlength: 500 },
      userAgent: { type: String, trim: true, default: "", maxlength: 400 },
      viewport: { type: String, trim: true, default: "", maxlength: 20 },
    },

    status: { type: String, enum: СОСТОЯНИЯ, default: "new", index: true },
    priority: { type: String, enum: ВАЖНОСТЬ, default: "normal" },

    messages: {
      type: [репликаSchema],
      default: [],
      validate: {
        validator: (v) => v.length <= МАКС_РЕПЛИК,
        message: `В обращении не может быть больше ${МАКС_РЕПЛИК} реплик`,
      },
    },

    /* Итог: чем кончилось и почему. Обязателен для закрытых состояний —
       «отклонено» без объяснения хуже, чем отсутствие ответа. */
    resolution: { type: String, trim: true, default: "", maxlength: 2000 },
    handledBy: { type: mongoose.Schema.Types.ObjectId, default: null },
    handledAt: { type: Date, default: null },

    /* Отметки времени для двух вопросов, которые задают каждый день:
       «есть ли непрочитанный ответ» (автору) и «ждут ли меня» (разбору).
       Считать их из массива реплик пришлось бы в каждом запросе списка. */
    lastAuthorAt: { type: Date, default: null },
    lastAdminAt: { type: Date, default: null },
    authorReadAt: { type: Date, default: null },
  },
  { timestamps: true },
);

/* Очередь разбора: сначала новые. */
feedbackSchema.index({ status: 1, createdAt: -1 });
/* Свои обращения в кабинете. */
feedbackSchema.index({ authorId: 1, createdAt: -1 });
/* Разбор по видам: ошибки смотрят отдельно от пожеланий. */
feedbackSchema.index({ kind: 1, status: 1, createdAt: -1 });

feedbackSchema.pre("validate", function проверить(next) {
  const закрыто = ЗАКРЫТЫЕ.includes(this.status);
  if (закрыто && !this.resolution?.trim()) {
    return next(
      new Error("Закрытое обращение должно содержать итог: что решили и почему"),
    );
  }
  if (закрыто && !this.handledBy) {
    return next(new Error("У закрытого обращения должен быть разбирающий"));
  }
  return next();
});

export default mongoose.models.Feedback ||
  mongoose.model("Feedback", feedbackSchema);
