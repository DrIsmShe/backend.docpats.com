// server/modules/anthropometry/models/AuditLog.model.js

import mongoose from "mongoose";

const { Schema } = mongoose;

/* ============================================================
   ENUMS
   ============================================================ */

const ACTION_ENUM = [
  // Cases
  "case.create",
  "case.view",
  "case.update",
  "case.archive",
  "case.unarchive",
  "case.delete",
  "case.consent_given",
  "case.consent_revoked",

  // Studies
  "study.create",
  "study.view",
  "study.update",
  "study.delete",
  "study.calibrate",
  "study.recalibrate",

  // Photos
  "photo.upload",
  "photo.view", // рендер фото в UI
  "photo.download", // скачивание файла
  "photo.delete",

  // Annotations
  "annotation.create",
  "annotation.view",
  "annotation.update",
  "annotation.create_version",
  "annotation.lock",
  "annotation.unlock",
  "annotation.delete",
  "annotation.set_current",

  // Bulk / export
  "case.export",
  "study.export",
];

const RESOURCE_TYPE_ENUM = ["PatientCase", "Study", "Photo", "Annotation"];

const OUTCOME_ENUM = ["success", "failure", "denied"];

/* ============================================================
   SCHEMA
   ============================================================ */

const AuditLogSchema = new Schema(
  {
    /* ---------------------------------
       ACTOR (who performed the action)
       --------------------------------- */
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // Снэпшот email на момент действия — для трассируемости
    // даже после удаления/смены аккаунта пользователя
    actorEmail: { type: String },
    actorRole: { type: String }, // "doctor", "admin", и т.п.

    /* ---------------------------------
       ACTION (what was done)
       --------------------------------- */
    action: {
      type: String,
      enum: ACTION_ENUM,
      required: true,
      index: true,
    },

    /* ---------------------------------
       RESOURCE (what was affected)
       --------------------------------- */
    resourceType: {
      type: String,
      enum: RESOURCE_TYPE_ENUM,
      required: true,
    },
    resourceId: {
      type: Schema.Types.ObjectId,
      required: true,
    },

    // Денормализуем caseId на верхний уровень для быстрых
    // выборок "вся история по случаю". Заполняется всегда,
    // даже если действие на photo или annotation —
    // через цепочку находим case.
    caseId: {
      type: Schema.Types.ObjectId,
      ref: "PatientCase",
      index: true,
    },

    /* ---------------------------------
       OUTCOME
       ---------------------------------
       Логируем не только успешные действия, но и
       отказы доступа и ошибки — это критично для
       детекции попыток несанкционированного доступа. */
    outcome: {
      type: String,
      enum: OUTCOME_ENUM,
      default: "success",
    },

    failureReason: { type: String },

    /* ---------------------------------
       METADATA (structured but flexible)
       ---------------------------------
       Свободная структура. Примеры:
       - case.update: { changedFields: ["status", "chiefComplaint"] }
       - photo.view: { viewType: "lateral_left" }
       - annotation.create_version: { fromVersion: 1, toVersion: 2 }
       - study.calibrate: { method: "ruler", pixelsPerMm: 8.42 } */
    metadata: { type: Schema.Types.Mixed, default: null },

    /* ---------------------------------
       REQUEST CONTEXT
       ---------------------------------
       Без этих полей audit log не имеет юридической силы.
       Заполняются автоматически в audit.service.js из req. */
    ipAddress: { type: String },
    userAgent: { type: String },
    sessionId: { type: String },

    // Для API-вызовов от внешних систем
    requestId: { type: String },
  },
  {
    // Только createdAt — записи append-only, updatedAt не нужен
    timestamps: { createdAt: true, updatedAt: false },

    // Запрещаем strict false — в audit log не должно быть
    // случайных полей, которые могут что-то скрыть
    strict: true,
  },
);

/* ============================================================
   ENFORCING APPEND-ONLY
   ============================================================
   Запрещаем update и delete на уровне модели.
   Это последний рубеж защиты — основная защита через
   разрешения БД (этим занимается DBA). */

AuditLogSchema.pre("findOneAndUpdate", function (next) {
  next(new Error("AuditLog records are immutable — update is forbidden"));
});

AuditLogSchema.pre("updateOne", function (next) {
  next(new Error("AuditLog records are immutable — update is forbidden"));
});

AuditLogSchema.pre("updateMany", function (next) {
  next(new Error("AuditLog records are immutable — update is forbidden"));
});

AuditLogSchema.pre("deleteOne", function (next) {
  next(new Error("AuditLog records are immutable — delete is forbidden"));
});

AuditLogSchema.pre("deleteMany", function (next) {
  next(new Error("AuditLog records are immutable — delete is forbidden"));
});

AuditLogSchema.pre("findOneAndDelete", function (next) {
  next(new Error("AuditLog records are immutable — delete is forbidden"));
});

// Также блокируем save() для существующих документов.
// Создание новых разрешено (this.isNew === true).
AuditLogSchema.pre("save", function (next) {
  if (!this.isNew) {
    return next(
      new Error("AuditLog records are immutable — modification is forbidden"),
    );
  }
  next();
});

/* ============================================================
   STATIC METHODS — read-only queries
   ============================================================ */

// История действий по случаю (для админ-панели и compliance)
AuditLogSchema.statics.findByCase = function (caseId, opts = {}) {
  const { limit = 100, skip = 0, action } = opts;
  const filter = { caseId };
  if (action) filter.action = action;

  return this.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit);
};

// История действий пользователя за период
AuditLogSchema.statics.findByUser = function (userId, opts = {}) {
  const { from, to, limit = 100 } = opts;
  const filter = { userId };
  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = from;
    if (to) filter.createdAt.$lte = to;
  }
  return this.find(filter).sort({ createdAt: -1 }).limit(limit);
};

// Кто смотрел конкретный ресурс
AuditLogSchema.statics.findResourceViews = function (
  resourceType,
  resourceId,
  opts = {},
) {
  const { limit = 100 } = opts;
  return this.find({
    resourceType,
    resourceId,
    action: { $regex: /\.view$/ },
  })
    .sort({ createdAt: -1 })
    .limit(limit);
};

// Поиск подозрительной активности — отказы доступа
AuditLogSchema.statics.findDeniedAttempts = function (opts = {}) {
  const { from, userId, limit = 200 } = opts;
  const filter = { outcome: "denied" };
  if (userId) filter.userId = userId;
  if (from) filter.createdAt = { $gte: from };
  return this.find(filter).sort({ createdAt: -1 }).limit(limit);
};

/* ============================================================
   INDEXES
   ============================================================ */

// История по пользователю за период
AuditLogSchema.index({ userId: 1, createdAt: -1 });

// История по случаю
AuditLogSchema.index({ caseId: 1, createdAt: -1 });

// Просмотры конкретного ресурса
AuditLogSchema.index({ resourceType: 1, resourceId: 1, createdAt: -1 });

// Все действия определённого типа
AuditLogSchema.index({ action: 1, createdAt: -1 });

// Подозрительная активность
AuditLogSchema.index({ outcome: 1, createdAt: -1 });

/* ============================================================
   MODEL
   ============================================================ */

const AuditLog =
  mongoose.models.AnthropometryAuditLog ||
  mongoose.model(
    "AnthropometryAuditLog",
    AuditLogSchema,
    "anthropometry_audit_logs",
  );

export default AuditLog;
