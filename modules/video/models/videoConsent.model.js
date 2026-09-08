// server/modules/video/models/videoConsent.model.js
//
// VideoConsent — информированное согласие пациента, подтверждённое просмотром
// объяснительного ролика.
//
// ЭТО НЕ PatientConsent. Тот про доступ клиники к медицинским данным
// («можно ли вам смотреть мою карту»). Этот — про осведомлённость о
// вмешательстве («мне объяснили, что со мной будут делать»). Две разные
// вещи, и складывать их в одну модель нельзя: у них разный предмет, разный
// срок жизни и разные основания отзыва.
//
// ЗАЧЕМ ВООБЩЕ. Обычное согласие — галочка под текстом, который никто не
// читает. В споре она доказывает только то, что кто-то нажал кнопку. Ролик
// с зафиксированной глубиной просмотра доказывает другое: человеку
// объяснили, и он смотрел до конца. Ради этой разницы всё и делается.
//
// ЧТО ХРАНИМ СНИМКОМ, А НЕ ССЫЛКОЙ. Ролик живёт своей жизнью: его могут
// перезалить, переименовать, удалить. Согласие обязано пережить это и
// ответить на вопрос «что именно человек видел тогда» — поэтому в документе
// лежит снимок ролика на момент просмотра, а не только его идентификатор.
//
// НИКАКОГО PHI В ПОЛЯХ. Название процедуры — не диагноз и не имя; сам
// клинический контекст живёт в приёме и в карте, сюда не копируется.

import mongoose from "mongoose";

/** Состояния. Порядок — жизненный путь документа. */
export const CONSENT_STATUSES = Object.freeze([
  "pending", // запрошено, пациент ещё не досмотрел
  "watched", // досмотрел — можно подписывать
  "signed", // подписано
  "revoked", // отозвано пациентом
  "expired", // срок вышел, подписи не случилось
]);

/* ── Снимок ролика на момент просмотра ────────────────────────────
   Отвечает на вопрос «что именно было показано», даже если ролик потом
   переделали или стёрли. Длительность здесь же: без неё «досмотрел до
   конца» — утверждение ни о чём. */
const videoSnapshotSchema = new mongoose.Schema(
  {
    videoId: { type: mongoose.Schema.Types.ObjectId, ref: "Video", required: true },
    title: { type: String, trim: true, default: "", maxlength: 300 },
    durationSec: { type: Number, default: 0, min: 0 },
    lang: { type: String, trim: true, default: "" },
    // Ключ файла и время последнего изменения записи — по ним видно, что
    // ролик после подписания подменили.
    storageKey: { type: String, trim: true, default: "" },
    videoUpdatedAt: { type: Date, default: null },
  },
  { _id: false },
);

/* ── Факт просмотра ───────────────────────────────────────────────
   Дублирует то, что уже записано в hipaa_audit_logs, и это осознанно:
   журнал — источник правды, но выбирать из него на каждый показ карточки
   дорого. Расхождение между ними само по себе сигнал. */
const watchSchema = new mongoose.Schema(
  {
    firstWatchAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    watchedSec: { type: Number, default: 0, min: 0 },
    ratio: { type: Number, default: 0, min: 0, max: 1 },
    attempts: { type: Number, default: 0, min: 0 },
  },
  { _id: false },
);

const videoConsentSchema = new mongoose.Schema(
  {
    clinicId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Clinic",
      required: true,
      index: true,
    },

    /* Пациент в двух видах, и оба обязательны по своей причине:
       clinicPatientId — карта, в которой живёт клинический контекст;
       patientUserId — аккаунт, из которого человек подпишет. Без второго
       подписывать было бы некому: карту заводит клиника, а согласие даёт
       человек. */
    clinicPatientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ClinicPatient",
      required: true,
      index: true,
    },
    patientUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    /* Приём, к которому привязано согласие. Необязателен: объяснение могут
       дать и до записи на приём. */
    appointmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ClinicAppointment",
      default: null,
      index: true,
    },

    /** Что именно объясняли. Название вмешательства, не диагноз. */
    procedureName: { type: String, trim: true, required: true, maxlength: 300 },

    video: { type: videoSnapshotSchema, required: true },
    watch: { type: watchSchema, default: () => ({}) },

    status: {
      type: String,
      enum: CONSENT_STATUSES,
      default: "pending",
      required: true,
      index: true,
    },

    /* Кто потребовал согласия — врач или регистратура. */
    requestedByMembershipId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ClinicMembership",
      default: null,
    },
    requestedAt: { type: Date, default: Date.now },

    /* Срок. Согласие, данное полгода назад под другой ролик, юридически
       сомнительно, поэтому у запроса есть предел жизни. */
    expiresAt: { type: Date, default: null },

    signedAt: { type: Date, default: null },
    /* Как подписано. Пока способ один — нажатие в кабинете после досмотра;
       поле заведено, чтобы добавление ASAN İmza не потребовало миграции. */
    signatureMethod: {
      type: String,
      enum: ["in_app", "asan_imza", "paper"],
      default: "in_app",
    },

    revokedAt: { type: Date, default: null },
    revokedReason: { type: String, trim: true, default: "", maxlength: 500 },
  },
  { timestamps: true },
);

/* ── ИНДЕКСЫ ──────────────────────────────────────────────────────── */
// Кабинет пациента: «что мне нужно посмотреть и подписать».
videoConsentSchema.index({ patientUserId: 1, status: 1, createdAt: -1 });
// Клиника: список по пациенту и по приёму.
videoConsentSchema.index({ clinicId: 1, clinicPatientId: 1, createdAt: -1 });
// Cron истечения.
videoConsentSchema.index({ status: 1, expiresAt: 1 });

/* ── ПРАВИЛО, КОТОРОЕ НЕЛЬЗЯ ОБОЙТИ ───────────────────────────────
   Подпись без досмотра превращает всю затею обратно в галочку. Проверка
   стоит в модели, а не только в сервисе: подписанный документ обязан быть
   невозможен без завершённого просмотра, каким бы кодом его ни создавали. */
videoConsentSchema.pre("validate", function (next) {
  if (this.signedAt && !this.watch?.completedAt) {
    return next(
      new Error("Согласие нельзя подписать, пока ролик не досмотрен до конца"),
    );
  }
  if (this.signedAt && this.revokedAt && this.revokedAt < this.signedAt) {
    return next(new Error("Отзыв не может предшествовать подписи"));
  }
  next();
});

const VideoConsent =
  mongoose.models.VideoConsent ||
  mongoose.model("VideoConsent", videoConsentSchema);

export default VideoConsent;
