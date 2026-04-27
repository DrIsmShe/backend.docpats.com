// server/modules/anthropometry/models/Annotation.model.js

import mongoose from "mongoose";

const { Schema } = mongoose;

/* ============================================================
   ENUMS
   ============================================================ */

const PRESET_TYPE_ENUM = [
  "rhinoplasty_lateral",
  // На будущее:
  // "rhinoplasty_frontal",
  // "rhinoplasty_basal",
  // "mammoplasty_frontal",
  // ...
];

const CONFIDENCE_ENUM = [
  "manual", // поставлено врачом вручную
  "auto", // авто-раскладка (default из preset), не подтверждено
  "corrected", // авто + правка врача
  "ai_detected", // на будущее, ML-детекция
];

const MEASUREMENT_TYPE_ENUM = ["angle", "distance", "ratio"];

const INTERPRETATION_ENUM = [
  "within_norm",
  "above_norm",
  "below_norm",
  "unknown", // не вычислено или нет нормы
];

/* ============================================================
   SUB-SCHEMAS
   ============================================================ */

const Point2DSchema = new Schema(
  {
    x: { type: Number, required: true, min: 0, max: 1 },
    y: { type: Number, required: true, min: 0, max: 1 },
  },
  { _id: false },
);

const LandmarkSchema = new Schema(
  {
    id: { type: String, required: true }, // "glabella", "nasion", ...
    x: { type: Number, required: true, min: 0, max: 1 },
    y: { type: Number, required: true, min: 0, max: 1 },
    confidence: {
      type: String,
      enum: CONFIDENCE_ENUM,
      default: "manual",
    },
    placedAt: { type: Date, default: Date.now },
    placedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { _id: false },
);

const MeasurementSchema = new Schema(
  {
    code: { type: String, required: true }, // "nasofrontal_angle"
    type: {
      type: String,
      enum: MEASUREMENT_TYPE_ENUM,
      required: true,
    },
    // Какие точки участвовали (для трассировки)
    pointIds: { type: [String], required: true },

    value: { type: Number, required: true },
    unit: { type: String, required: true }, // "degrees", "mm", "ratio"

    // Норма на момент вычисления
    normMin: { type: Number },
    normMax: { type: Number },
    interpretation: {
      type: String,
      enum: INTERPRETATION_ENUM,
      default: "unknown",
    },
  },
  { _id: false },
);

/* ============================================================
   MAIN SCHEMA
   ============================================================ */

const AnnotationSchema = new Schema(
  {
    /* ---------------------------------
       PARENT REFERENCES (denormalized)
       --------------------------------- */
    photoId: {
      type: Schema.Types.ObjectId,
      ref: "Photo",
      required: true,
      index: true,
    },
    studyId: {
      type: Schema.Types.ObjectId,
      ref: "Study",
      required: true,
      index: true,
    },
    caseId: {
      type: Schema.Types.ObjectId,
      ref: "PatientCase",
      required: true,
      index: true,
    },
    doctorUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    /* ---------------------------------
       PRESET
       --------------------------------- */
    presetType: {
      type: String,
      enum: PRESET_TYPE_ENUM,
      required: true,
      index: true,
    },

    presetVersion: {
      type: String,
      required: true, // версия preset на момент создания
    },

    /* ---------------------------------
       VERSIONING (Strategy A)
       ---------------------------------
       version       : номер версии аннотации (1, 2, 3, ...)
       parentVersion : ссылка на предыдущую версию (null для v1)
       isCurrent     : актуальна ли эта версия (только одна
                       isCurrent=true для (photoId, presetType)) */
    version: {
      type: Number,
      required: true,
      min: 1,
    },
    parentVersion: {
      type: Schema.Types.ObjectId,
      ref: "Annotation",
      default: null,
    },
    isCurrent: {
      type: Boolean,
      default: true,
      index: true,
    },

    /* ---------------------------------
       LOCK
       ---------------------------------
       Залоченную аннотацию нельзя редактировать.
       Можно только сделать новую версию. */
    isLocked: { type: Boolean, default: false },
    lockedAt: { type: Date },
    lockedBy: { type: Schema.Types.ObjectId, ref: "User" },
    lockReason: { type: String },

    /* ---------------------------------
       DATA
       --------------------------------- */
    landmarks: {
      type: [LandmarkSchema],
      default: [],
    },

    measurements: {
      type: [MeasurementSchema],
      default: [],
    },

    /* ---------------------------------
       USER NOTES
       --------------------------------- */
    description: { type: String, maxlength: 2000 },

    /* ---------------------------------
       SOFT DELETE
       --------------------------------- */
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date },
    deletedBy: { type: Schema.Types.ObjectId, ref: "User" },

    /* ---------------------------------
       AUDIT
       --------------------------------- */
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

/* ============================================================
   VALIDATION HOOKS
   ============================================================ */

// Залоченную аннотацию нельзя изменять (кроме служебных полей)
AnnotationSchema.pre("save", function (next) {
  if (!this.isNew && this.isLocked) {
    const allowedFields = ["isCurrent", "isDeleted", "deletedAt", "deletedBy"];
    const modified = this.modifiedPaths().filter(
      (p) => !allowedFields.some((a) => p === a || p.startsWith(`${a}.`)),
    );
    if (modified.length > 0) {
      return next(
        new Error(
          `Cannot modify locked annotation. Modified: ${modified.join(", ")}`,
        ),
      );
    }
  }
  next();
});

// Авто-проставление lockedAt
AnnotationSchema.pre("save", function (next) {
  if (this.isModified("isLocked") && this.isLocked && !this.lockedAt) {
    this.lockedAt = new Date();
  }
  next();
});

/* ============================================================
   INSTANCE METHODS
   ============================================================ */

// Можно ли редактировать
AnnotationSchema.methods.isEditable = function () {
  return !this.isLocked && !this.isDeleted && this.isCurrent;
};

// Найти landmark по id
AnnotationSchema.methods.getLandmark = function (id) {
  return this.landmarks.find((l) => l.id === id) || null;
};

// Найти measurement по коду
AnnotationSchema.methods.getMeasurement = function (code) {
  return this.measurements.find((m) => m.code === code) || null;
};

/* ============================================================
   STATIC METHODS
   ============================================================ */

// Текущая (актуальная) аннотация для фото
AnnotationSchema.statics.findCurrent = function (photoId, presetType) {
  return this.findOne({
    photoId,
    presetType,
    isCurrent: true,
    isDeleted: false,
  });
};

// История версий по фото и preset, от новой к старой
AnnotationSchema.statics.findHistory = function (photoId, presetType) {
  return this.find({
    photoId,
    presetType,
    isDeleted: false,
  }).sort({ version: -1 });
};

// Все аннотации случая (для дашборда)
AnnotationSchema.statics.findCurrentByCase = function (caseId) {
  return this.find({
    caseId,
    isCurrent: true,
    isDeleted: false,
  });
};

/* ============================================================
   INDEXES
   ============================================================ */

// Главный индекс — текущая версия аннотации для фото+preset.
// UNIQUE при isCurrent=true гарантирует что не может быть
// двух актуальных версий одновременно.
AnnotationSchema.index(
  { photoId: 1, presetType: 1, isCurrent: 1 },
  {
    unique: true,
    partialFilterExpression: { isCurrent: true, isDeleted: false },
  },
);

// История версий
AnnotationSchema.index({ photoId: 1, presetType: 1, version: -1 });

// Аннотации случая
AnnotationSchema.index({ caseId: 1, isCurrent: 1, isDeleted: 1 });

// Аннотации сессии
AnnotationSchema.index({ studyId: 1, isCurrent: 1, isDeleted: 1 });

/* ============================================================
   MODEL
   ============================================================ */

const Annotation =
  mongoose.models.Annotation ||
  mongoose.model("Annotation", AnnotationSchema, "anthropometry_annotations");

export default Annotation;
