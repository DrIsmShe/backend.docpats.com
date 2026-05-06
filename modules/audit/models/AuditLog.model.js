// modules/audit/models/AuditLog.model.js
//
// HIPAA-compliant Audit Log model.
//
// HIPAA § 164.312(b) — требует журнал доступа к PHI.
//
// Дизайн на основе anthropometry-модуля (там было сделано хорошо),
// расширен для использования всеми PHI-модулями платформы.
//
// Хранится в коллекции `hipaa_audit_logs`. Имя модели —
// `HIPAAAuditLog` (уникальное, не пересекается со старым `AuditLog`
// в common/models/auditLog.js и `AnthropometryAuditLog`).
//
// ВАЖНО про индексы:
//   В этой модели НЕ используется `index: true` ни на одном поле.
//   Все индексы определены через `AuditLogSchema.index({...})` ниже.
//   Это сделано чтобы:
//   1. Не было дубликатов (warning от mongoose)
//   2. Composite indexes покрывают одиночные запросы
//      (Mongo использует префикс composite индекса)
//   3. Чёткая видимость списка всех индексов в одном месте

import mongoose from "mongoose";
import {
  ACTION_ENUM,
  RESOURCE_TYPE_ENUM,
  OUTCOME_ENUM,
} from "../enums/auditEnums.js";

const { Schema } = mongoose;

// HIPAA минимум — 6 лет хранения. Берём 7 для запаса.
const SEVEN_YEARS_SEC = 7 * 365 * 24 * 60 * 60;

const AuditLogSchema = new Schema(
  {
    /* ═══════════ ACTOR (кто действовал) ═══════════ */
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    // Если действие совершалось от имени другого пользователя
    // (admin за doctor) — здесь оригинальный actor.
    impersonatedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    // Снэпшот email/role на момент действия — для трассируемости
    // даже после удаления/смены аккаунта пользователя.
    actorEmail: { type: String, default: null },
    actorRole: { type: String, default: null },

    /* ═══════════ ACTION (что было сделано) ═══════════ */
    action: {
      type: String,
      enum: ACTION_ENUM,
      required: true,
    },

    /* ═══════════ RESOURCE (на чём было сделано) ═══════════ */
    resourceType: {
      type: String,
      enum: RESOURCE_TYPE_ENUM,
      required: true,
    },

    // ID конкретного ресурса. Может быть null для "list" actions.
    resourceId: {
      type: Schema.Types.ObjectId,
      default: null,
    },

    // Денормализованный caseId для anthropometry — позволяет одним запросом
    // взять "всю историю по случаю". Заполняется вручную из service-слоя
    // если применимо.
    caseId: {
      type: Schema.Types.ObjectId,
      default: null,
    },

    // Кто владелец ресурса (если применимо). Например, при чтении карты
    // пациента — userId пациента. Это позволяет одним запросом узнать
    // "кто читал данные пациента X" (ключевое для HIPAA-аудита).
    resourceOwnerId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    /* ═══════════ OUTCOME (результат) ═══════════ */
    outcome: {
      type: String,
      enum: OUTCOME_ENUM,
      default: "success",
    },

    failureReason: {
      type: String,
      default: null,
      maxlength: 1000,
    },

    /* ═══════════ HTTP CONTEXT (для запроса) ═══════════ */
    httpMethod: {
      type: String,
      enum: ["GET", "POST", "PUT", "PATCH", "DELETE", null],
      default: null,
    },
    httpPath: {
      type: String,
      default: null,
      maxlength: 500,
    },
    statusCode: {
      type: Number,
      default: null,
    },

    /* ═══════════ REQUEST CONTEXT ═══════════ */
    ipAddress: { type: String, default: null },
    userAgent: { type: String, default: null, maxlength: 500 },
    sessionId: { type: String, default: null },
    requestId: { type: String, default: null },

    /* ═══════════ METADATA (произвольно, БЕЗ PHI) ═══════════
       Свободная структура. Примеры:
       - case.update: { changedFields: ["status"] }
       - photo.view: { viewType: "lateral_left" }
       - chat.message.create: { dialogId, messageType: "text" }
       
       ВАЖНО: НЕ клади сюда сами PHI — только идентификаторы и
       технические детали. */
    metadata: {
      type: Schema.Types.Mixed,
      default: null,
    },
  },
  {
    // timestamps создаст createdAt автоматически. updatedAt не нужен —
    // записи immutable.
    timestamps: { createdAt: true, updatedAt: false },

    // Запрещаем сохранение полей, не описанных в схеме
    strict: true,

    // Имя коллекции
    collection: "hipaa_audit_logs",
  },
);

/* ═══════════════════════════════════════════════════════════════════════
   INDEXES
   ═══════════════════════════════════════════════════════════════════════
   Все индексы определены ЗДЕСЬ — в одном месте.
   Никакого `index: true` на полях схемы выше.
   
   Composite indexes покрывают одиночные запросы благодаря prefix-rule:
   индекс { userId: 1, createdAt: -1 } может использоваться для
   запросов где есть только userId.
   ═══════════════════════════════════════════════════════════════════════ */

// "Что юзер X делал за период" + одиночные запросы по userId
AuditLogSchema.index({ userId: 1, createdAt: -1 });

// "Кто читал данные пациента X" + одиночные запросы по resourceOwnerId
AuditLogSchema.index({ resourceOwnerId: 1, createdAt: -1 });

// "Все действия с конкретным объектом" + по resourceId/Type
AuditLogSchema.index({ resourceType: 1, resourceId: 1, createdAt: -1 });

// "Вся история по случаю" (anthropometry)
AuditLogSchema.index({ caseId: 1, createdAt: -1 });

// "Подозрительная активность" (security monitoring)
AuditLogSchema.index({ outcome: 1, createdAt: -1 });

// "Что делал юзер с конкретным типом ресурса"
AuditLogSchema.index({ userId: 1, resourceType: 1, createdAt: -1 });

// "Все действия определённого типа за период" (для аналитики)
AuditLogSchema.index({ action: 1, createdAt: -1 });

/* ═══════════ TTL — авто-удаление через 7 лет ═══════════
   MongoDB сам удаляет документы где createdAt + 7 лет < сейчас.
   Это требование HIPAA минимум 6 лет, мы берём 7 для запаса. */
AuditLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: SEVEN_YEARS_SEC });

/* ═══════════ APPEND-ONLY GUARDS ═══════════
   Запрещаем update и delete на уровне модели.
   Это последний рубеж защиты — основная защита через
   разрешения БД (этим занимается DBA / Atlas roles). */

AuditLogSchema.pre("findOneAndUpdate", function (next) {
  next(new Error("HIPAAAuditLog records are immutable — update is forbidden"));
});

AuditLogSchema.pre("updateOne", function (next) {
  next(new Error("HIPAAAuditLog records are immutable — update is forbidden"));
});

AuditLogSchema.pre("updateMany", function (next) {
  next(new Error("HIPAAAuditLog records are immutable — update is forbidden"));
});

AuditLogSchema.pre("deleteOne", function (next) {
  next(new Error("HIPAAAuditLog records are immutable — delete is forbidden"));
});

AuditLogSchema.pre("deleteMany", function (next) {
  next(new Error("HIPAAAuditLog records are immutable — delete is forbidden"));
});

AuditLogSchema.pre("findOneAndDelete", function (next) {
  next(new Error("HIPAAAuditLog records are immutable — delete is forbidden"));
});

// Также блокируем save() для существующих документов.
// Создание новых разрешено (this.isNew === true).
AuditLogSchema.pre("save", function (next) {
  if (!this.isNew) {
    return next(
      new Error(
        "HIPAAAuditLog records are immutable — modification is forbidden",
      ),
    );
  }
  next();
});

/* ═══════════ STATIC METHODS — read-only queries ═══════════ */

// История действий пользователя за период
AuditLogSchema.statics.findByUser = function (userId, opts = {}) {
  const { from, to, action, limit = 100, skip = 0 } = opts;
  const filter = { userId };
  if (action) filter.action = action;
  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = from;
    if (to) filter.createdAt.$lte = to;
  }
  return this.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit);
};

// История по случаю (anthropometry)
AuditLogSchema.statics.findByCase = function (caseId, opts = {}) {
  const { limit = 100, skip = 0, action } = opts;
  const filter = { caseId };
  if (action) filter.action = action;
  return this.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit);
};

// Кто работал с конкретным ресурсом
AuditLogSchema.statics.findByResource = function (
  resourceType,
  resourceId,
  opts = {},
) {
  const { limit = 100, action } = opts;
  const filter = { resourceType, resourceId };
  if (action) filter.action = action;
  return this.find(filter).sort({ createdAt: -1 }).limit(limit);
};

// Кто работал с PHI конкретного пользователя (пациента)
AuditLogSchema.statics.findByOwner = function (resourceOwnerId, opts = {}) {
  const { from, to, limit = 100 } = opts;
  const filter = { resourceOwnerId };
  if (from || to) {
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = from;
    if (to) filter.createdAt.$lte = to;
  }
  return this.find(filter).sort({ createdAt: -1 }).limit(limit);
};

// Подозрительная активность — отказы доступа
AuditLogSchema.statics.findDeniedAttempts = function (opts = {}) {
  const { from, userId, limit = 200 } = opts;
  const filter = { outcome: "denied" };
  if (userId) filter.userId = userId;
  if (from) filter.createdAt = { $gte: from };
  return this.find(filter).sort({ createdAt: -1 }).limit(limit);
};

// Просмотры конкретного ресурса (для запроса "кто видел мои данные")
AuditLogSchema.statics.findResourceViews = function (
  resourceType,
  resourceId,
  opts = {},
) {
  const { limit = 100 } = opts;
  return this.find({
    resourceType,
    resourceId,
    action: { $regex: /\.(read|view)$|^read$/ },
  })
    .sort({ createdAt: -1 })
    .limit(limit);
};

/* ═══════════ MODEL ═══════════
   Уникальное имя `HIPAAAuditLog` — не пересекается со старым
   `AuditLog` (в common/models/auditLog.js) и `AnthropometryAuditLog`. */

const HIPAAAuditLog =
  mongoose.models.HIPAAAuditLog ||
  mongoose.model("HIPAAAuditLog", AuditLogSchema, "hipaa_audit_logs");

export default HIPAAAuditLog;
