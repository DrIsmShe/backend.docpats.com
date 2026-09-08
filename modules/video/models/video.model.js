// server/modules/video/models/video.model.js
//
// Video — запись каталога фильмов. Файл лежит в R2, запись живёт здесь.
//
// ЗАЧЕМ ОТДЕЛЬНЫЙ КАТАЛОГ. Студия DP-Videra — служба на другом сервере, и
// своей базы пользователей у неё нет (см. modules/videra/pass.js). Пока
// фильм существует только там, его нельзя ни прикрепить к приёму, ни
// показать по праву, ни проаудировать. Каталог — это то место, где фильм
// становится объектом платформы, а не файлом в чужом хранилище.
//
// МОДУЛЬ ГЛОБАЛЬНЫЙ, НЕ КЛИНИЧЕСКИЙ. Фильмы снимают и врач-одиночка, и
// пациент, и клиника — поэтому clinicId необязателен, а плагин tenantScoped
// НЕ подключён: он отрезал бы владельцу его же ролики, снятые вне клиники.
// Ограничение по клинике делает сервис явным условием — тем же способом, что
// и остальные clinic-* модули (см. clinicAnnouncement.model.js).
//
// ПРИВАТНОСТЬ ПО УМОЛЧАНИЮ. visibility начинается с "private", и это не
// вкусовое решение: как только в кадр попадает пациент, ролик становится
// медицинской записью. Дефолт «разберёмся потом» здесь означает утечку.
//
// НАЗВАНИЕ И ОПИСАНИЕ — НЕ PHI. Они не шифруются, попадают в витрину и в
// поисковую выдачу. Имя пациента, дата рождения и номер карты в них
// недопустимы; ролик про конкретного человека опознаётся по attachments, а
// не по названию.

import mongoose from "mongoose";
import {
  VIDEO_KINDS,
  VIDEO_SOURCES,
  VIDEO_VISIBILITY,
  VIDEO_STATUSES,
  VIDEO_LOCALES,
  VIDEO_LICENSES,
} from "../constants.js";

/* ── Дорожка одного языка ─────────────────────────────────────────
   Субтитры и озвучка живут отдельными файлами: заменить перевод, не
   перерендеривая картинку, — обычное дело, а для арабского ещё и
   единственный способ сохранить одну видеодорожку на все языки. */
const localeTrackSchema = new mongoose.Schema(
  {
    lang: { type: String, enum: VIDEO_LOCALES, required: true },
    subtitleKey: { type: String, trim: true, default: "" }, // .vtt в R2
    audioKey: { type: String, trim: true, default: "" }, // отдельная озвучка
    title: { type: String, trim: true, default: "", maxlength: 300 },
  },
  { _id: false },
);

/* ── Атрибуция исходного материала ────────────────────────────────
   Обязательна по условиям CC-лицензий и обязана быть читаемой в кадре.
   Хранится списком, потому что в одном ролике легко оказываются модели
   из разных источников с разными лицензиями. */
const attributionSchema = new mongoose.Schema(
  {
    title: { type: String, trim: true, required: true, maxlength: 300 },
    author: { type: String, trim: true, default: "", maxlength: 300 },
    license: { type: String, enum: VIDEO_LICENSES, required: true },
    url: { type: String, trim: true, default: "", maxlength: 1000 },
  },
  { _id: false },
);

/* ── Привязка к сущности платформы ────────────────────────────────
   Ради чего всё и затевалось: ролик перестаёт быть сиротой. Тип держим
   строкой, а не ref: сущности живут в разных модулях, и populate здесь
   не нужен — сервис каждого модуля знает, как достать свою запись. */
const attachmentSchema = new mongoose.Schema(
  {
    entityType: {
      type: String,
      required: true,
      enum: [
        "clinic-appointment",
        "clinic-patient",
        "clinic-medical-encounter",
        "radiology-case",
        "consultation",
        "doctor-profile",
        "clinic",
      ],
    },
    entityId: { type: mongoose.Schema.Types.ObjectId, required: true },
    at: { type: Date, default: Date.now },
    byMembershipId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ClinicMembership",
      default: null,
    },
  },
  { _id: false },
);

const videoSchema = new mongoose.Schema(
  {
    /* ── Кто владелец ─────────────────────────────────────────────
       userId старше employeeId — тот же порядок, что в tenantMiddleware
       и в модуле videra. ownerType говорит, в какой коллекции искать. */
    ownerType: {
      type: String,
      enum: ["user", "employee"],
      required: true,
    },
    ownerId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },

    /* Клиника, от имени которой снят ролик. Пусто — снимал одиночка.
       На это поле опирается видимость "clinic". */
    clinicId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Clinic",
      default: null,
      index: true,
    },

    title: { type: String, trim: true, required: true, maxlength: 300 },
    description: { type: String, trim: true, default: "", maxlength: 5000 },
    lang: { type: String, enum: VIDEO_LOCALES, default: "ru" },

    kind: { type: String, enum: VIDEO_KINDS, default: "explainer", index: true },

    /* Раздел витрины. Не заменяет kind: тот про природу записи и правила
       PHI, этот — про полку, на которой ролик показывают. */
    categoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "VideoCategory",
      default: null,
      index: true,
    },

    source: {
      kind: { type: String, enum: VIDEO_SOURCES, default: "studio" },
      /* Идентификатор фильма на стороне студии. По нему приходит вебхук о
         готовом рендере, поэтому индекс уникальный — второй вебхук про тот
         же фильм не должен создавать двойника. */
      studioFilmId: { type: String, trim: true, default: null },
      /* Из чего собран машинный ролик: эпикриз, случай радиологии, звонок.
         Заполняется в фазе 3; здесь — чтобы потом не мигрировать. */
      ref: {
        entityType: { type: String, trim: true, default: "" },
        entityId: { type: mongoose.Schema.Types.ObjectId, default: null },
      },
    },

    /* ── Файлы ────────────────────────────────────────────────────
       Ключи в R2, не URL: адрес выдаётся подписанным и живёт минуты. */
    media: {
      storageKey: { type: String, trim: true, default: "" }, // исходный mp4
      hlsKey: { type: String, trim: true, default: "" }, // манифест .m3u8
      posterKey: { type: String, trim: true, default: "" },
      durationSec: { type: Number, default: 0, min: 0 },
      sizeBytes: { type: Number, default: 0, min: 0 },
      mime: { type: String, trim: true, default: "video/mp4" },
    },

    /* ── Машинная сборка ──────────────────────────────────────────
       Сценарий хранится целиком: по нему врач принимает решение, по нему
       же студия рендерит, и он же остаётся ответом на вопрос «что именно
       подтвердили», если ролик потом переделают. */
    generation: {
      script: { type: mongoose.Schema.Types.Mixed, default: null },
      model: { type: String, trim: true, default: "" },
      generatedAt: { type: Date, default: null },
    },

    /* ── Врачебная проверка ───────────────────────────────────────
       Обязательна для машинных роликов: сгенерированный текст, который
       пациент услышал перед вмешательством, отозвать нельзя. Для снятых
       человеком роликов поле остаётся пустым — там автор и есть проверка. */
    review: {
      status: {
        type: String,
        enum: ["pending", "approved", "rejected"],
        default: null,
      },
      byUserId: { type: mongoose.Schema.Types.ObjectId, default: null },
      byMembershipId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "ClinicMembership",
        default: null,
      },
      at: { type: Date, default: null },
      notes: { type: String, trim: true, default: "", maxlength: 1000 },
    },

    locales: { type: [localeTrackSchema], default: [] },
    attribution: { type: [attributionSchema], default: [] },
    attachments: { type: [attachmentSchema], default: [] },

    /* ── Режим доступа ────────────────────────────────────────────
       phi — есть ли в кадре пациент или его данные. Публикацию такого
       ролика сервис запрещает независимо от прав: это не вопрос роли. */
    phi: { type: Boolean, default: false, index: true },
    visibility: {
      type: String,
      enum: VIDEO_VISIBILITY,
      default: "private",
      required: true,
      index: true,
    },

    status: {
      type: String,
      enum: VIDEO_STATUSES,
      default: "draft",
      required: true,
      index: true,
    },
    failureReason: { type: String, trim: true, default: "" },

    /* Под какой редакцией правил публикации загружен ролик. Пусто у
       снятых в студии и собранных машиной: правила касаются того, кто
       приносит готовый файл со стороны. */
    uploadTerms: {
      version: { type: String, trim: true, default: "" },
      acceptedAt: { type: Date, default: null },
    },

    /* ── Архив ────────────────────────────────────────────────────
       Промежуточное состояние между «живым» и «удалённым»: ролик исчезает
       из витрины и из списков, но файл цел и запись на месте. Нужен там,
       где удалять нельзя, а показывать больше не надо, — устаревшая
       рекомендация, ролик снятой с продажи услуги, материал врача,
       ушедшего из клиники. Удаление такое не заменяет: оно необратимо. */
    archivedAt: { type: Date, default: null, index: true },
    archivedBy: { type: mongoose.Schema.Types.ObjectId, default: null },
    archiveReason: { type: String, trim: true, default: "", maxlength: 500 },

    publishedAt: { type: Date, default: null },
    publishedBy: { type: mongoose.Schema.Types.ObjectId, default: null },

    /* Когда о ролике известили подписчиков. Отметка нужна, чтобы снятие с
       витрины и возврат обратно не звонили второй раз: подписчик получает
       новость о новом ролике, а не о том, что автор передумал. */
    subscribersNotifiedAt: { type: Date, default: null },

    /* Отметки «полезно». Массив идентификаторов, а не счётчик: так же
       устроены лайки статей и профилей врачей (likes: [User]), и третий
       механизм в одном продукте был бы лишним. Массив заодно отвечает на
       вопрос «отмечал ли этот человек», которого счётчик не знает. */
    likes: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],

    /* Отметки «не помогло». Хранятся так же и по той же причине, но
       наружу отдаётся только число: публичный счётчик минусов под
       медицинским роликом превращается в инструмент травли автора, а
       нам он нужен как сигнал для самого автора и модерации.
       Взаимоисключение с likes обеспечивает сервис: одновременно «да» и
       «нет» от одного человека — не мнение, а сбой. */
    dislikes: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],

    /* Разрешено ли встраивать ролик на чужих сайтах.
       По умолчанию да: опубликованный ролик и так открыт всем, а
       клинике важно мочь поставить его на свой сайт. Но выключатель
       нужен: автор вправе не хотеть, чтобы его разбор крутился внутри
       чужой страницы рядом с чем угодно. Скрытые и PHI-ролики не
       встраиваются никогда — это решает сервис, а не этот флаг. */
    allowEmbed: { type: Boolean, default: true },

    /* Расшифровка речи. Хранится целиком и рядом с роликом,
       а не только в виде субтитров: текст нужен поиску и тем, кто
       предпочитает прочитать. Машина могла расслышать неверно, поэтому
       рядом лежит модель: без неё не понять, чем сделан текст. */
    transcript: {
      lang: { type: String, default: "" },
      text: { type: String, default: "" },
      model: { type: String, default: "" },
      createdAt: { type: Date, default: null },
    },

    /* Счётчики витрины. Не источник правды для аудита: точные события
       просмотра лежат в hipaa_audit_logs, здесь — быстрые числа. */
    stats: {
      views: { type: Number, default: 0, min: 0 },
      completions: { type: Number, default: 0, min: 0 },
    },
  },
  { timestamps: true },
);

/* ── ИНДЕКСЫ ──────────────────────────────────────────────────────── */
// Кабинет: «мои ролики», новые сверху.
videoSchema.index({ ownerId: 1, createdAt: -1 });
// Лента клиники.
videoSchema.index({ clinicId: 1, status: 1, createdAt: -1 });
// Витрина DP-TUBE и sitemap: только опубликованные и готовые.
videoSchema.index({ visibility: 1, status: 1, publishedAt: -1 });
// Вебхук студии ищет запись по её идентификатору фильма.
//
// partialFilterExpression, а НЕ sparse. Поле вложенное и объявлено с
// default: null, поэтому mongoose записывает null всегда — для sparse это
// полноценное значение, и второй же ролик без идентификатора студии падал
// бы с E11000 по ключу null. Частичный индекс покрывает только записи, где
// идентификатор действительно строка.
videoSchema.index(
  { "source.studioFilmId": 1 },
  {
    unique: true,
    partialFilterExpression: { "source.studioFilmId": { $type: "string" } },
  },
);
// Поиск роликов, прикреплённых к приёму или карте.
videoSchema.index({ "attachments.entityType": 1, "attachments.entityId": 1 });

/* ── ПРАВИЛА, КОТОРЫЕ НЕ ДОЛЖНЫ ЗАВИСЕТЬ ОТ ВЫЗЫВАЮЩЕГО ───────────
   Эти две проверки живут в модели, а не в сервисе, намеренно: их нельзя
   обойти ни из cron, ни из воркера, ни из будущего кода, который забудет
   про сервисный слой. */
videoSchema.pre("validate", function (next) {
  // 1. Ролик с пациентом в кадре не бывает публичным. Никогда и ни для кого.
  if (this.phi && (this.visibility === "public" || this.visibility === "link")) {
    return next(
      new Error(
        "Ролик с пациентом в кадре нельзя открыть по ссылке или опубликовать (phi=true)",
      ),
    );
  }
  // 2. Видимость "clinic" без клиники бессмысленна и молча превратилась бы
  //    в «видно никому» — а выглядела бы как «видно коллегам».
  if (this.visibility === "clinic" && !this.clinicId) {
    return next(
      new Error("Видимость 'clinic' требует clinicId — иначе ролик не увидит никто"),
    );
  }
  // 3. Запись приёма — всегда PHI, чем бы её ни объявили при создании.
  if (this.kind === "encounter_record") this.phi = true;
  // 4. Машинный ролик без подтверждения врача не показывается никому, кроме
  //    владельца. Это последняя линия: правило живёт в модели, поэтому его
  //    не обойдёт ни воркер, ни будущий код мимо сервисного слоя.
  if (
    this.source?.kind === "generated" &&
    this.review?.status !== "approved" &&
    this.visibility !== "private"
  ) {
    return next(
      new Error(
        "Сгенерированный ролик нельзя открыть, пока сценарий не подтвердил врач",
      ),
    );
  }
  next();
});

// Защита от повторного импорта под vitest — стандарт проекта.
const Video = mongoose.models.Video || mongoose.model("Video", videoSchema);

export default Video;
