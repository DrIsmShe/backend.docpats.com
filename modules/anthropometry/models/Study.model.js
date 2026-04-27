// server/modules/anthropometry/models/Study.model.js

import mongoose from "mongoose";
import { encrypt, decrypt } from "../../../common/utils/crypto.js";

const { Schema } = mongoose;

/* ============================================================
   ENUMS
   ============================================================ */

const STUDY_TYPE_ENUM = [
  "pre_op", // предоперационная фотосессия
  "post_op_1w", // через 1 неделю после операции
  "post_op_1m", // через 1 месяц
  "post_op_3m", // через 3 месяца
  "post_op_6m", // через 6 месяцев
  "post_op_1y", // через 1 год
  "follow_up", // нестандартный контрольный визит
  "simulation", // симуляция результата (Фаза 2)
  "other",
];

const STUDY_STATUS_ENUM = [
  "draft", // фото загружены, калибровка не пройдена
  "calibrated", // готова к разметке
  "completed", // врач явно завершил работу с сессией
];

const CALIBRATION_METHOD_ENUM = [
  "ruler", // линейка/эталон в кадре
  "interpupillary", // межзрачковое расстояние
];

const PATIENT_GENDER_ENUM = ["male", "female", "other", "unknown"];

/* ============================================================
   SUB-SCHEMAS — описываем калибровку
   ============================================================
   Embedded документ внутри Study.
   _id: false — нет смысла в id для embedded поля. */

const Point2DSchema = new Schema(
  {
    x: { type: Number, required: true, min: 0, max: 1 }, // нормализованные 0..1
    y: { type: Number, required: true, min: 0, max: 1 },
  },
  { _id: false },
);

const RulerCalibrationSchema = new Schema(
  {
    referencePhotoId: {
      type: Schema.Types.ObjectId,
      ref: "Photo",
      required: true,
    },
    point1: { type: Point2DSchema, required: true },
    point2: { type: Point2DSchema, required: true },
    knownDistanceMm: {
      type: Number,
      required: true,
      min: 1,
      max: 500,
    },
  },
  { _id: false },
);

const InterpupillaryCalibrationSchema = new Schema(
  {
    referencePhotoId: {
      type: Schema.Types.ObjectId,
      ref: "Photo",
      required: true,
    },
    leftPupil: { type: Point2DSchema, required: true },
    rightPupil: { type: Point2DSchema, required: true },
    // Мы фиксируем какое значение использовали и пол —
    // на случай если врач захочет уточнить позже
    assumedDistanceMm: {
      type: Number,
      required: true,
      min: 40,
      max: 80,
      default: 63, // средневзвешенное для взрослого
    },
    patientGender: {
      type: String,
      enum: PATIENT_GENDER_ENUM,
      default: "unknown",
    },
  },
  { _id: false },
);

const CalibrationSchema = new Schema(
  {
    method: {
      type: String,
      enum: CALIBRATION_METHOD_ENUM,
      required: false, // null до калибровки
    },

    // Итоговый коэффициент пересчёта пикселей в миллиметры.
    // Вычисляется в calibration.service.js при сохранении.
    pixelsPerMm: {
      type: Number,
      min: 0,
    },

    // Только одна из двух подструктур заполняется.
    // Валидация в pre('validate') Study.
    ruler: { type: RulerCalibrationSchema },
    interpupillary: { type: InterpupillaryCalibrationSchema },

    isCalibrated: { type: Boolean, default: false },
    calibratedAt: { type: Date },
    calibratedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  { _id: false },
);

/* ============================================================
   MAIN SCHEMA
   ============================================================ */

const StudySchema = new Schema(
  {
    /* ---------------------------------
       PARENT REFERENCES
       --------------------------------- */
    caseId: {
      type: Schema.Types.ObjectId,
      ref: "PatientCase",
      required: true,
      index: true,
    },

    // Денормализация для быстрых выборок "все Study врача"
    doctorUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    /* ---------------------------------
       STUDY METADATA
       --------------------------------- */
    studyDate: {
      type: Date,
      required: true,
      index: true,
    },

    studyType: {
      type: String,
      enum: STUDY_TYPE_ENUM,
      required: true,
      index: true,
    },

    status: {
      type: String,
      enum: STUDY_STATUS_ENUM,
      default: "draft",
      index: true,
    },

    /* ---------------------------------
       CALIBRATION (embedded)
       --------------------------------- */
    calibration: {
      type: CalibrationSchema,
      default: () => ({ isCalibrated: false }),
    },

    /* ---------------------------------
       NOTES (encrypted)
       ---------------------------------
       Свободные заметки врача к сессии — могут содержать
       клинические наблюдения, поэтому шифруем. */
    notesEncrypted: { type: String },

    /* ---------------------------------
       SOFT DELETE & ARCHIVE
       --------------------------------- */
    isArchived: { type: Boolean, default: false, index: true },
    archivedAt: { type: Date },
    archiveReason: { type: String },

    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date },
    deletedBy: { type: Schema.Types.ObjectId, ref: "User" },
    deleteReason: { type: String },

    /* ---------------------------------
       AUDIT
       --------------------------------- */
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
  },
  {
    timestamps: true,
    toJSON: {
      virtuals: true,
      transform: (_, ret) => {
        delete ret.notesEncrypted;
        return ret;
      },
    },
    toObject: { virtuals: true },
  },
);

/* ============================================================
   VIRTUALS
   ============================================================ */

StudySchema.virtual("notes")
  .get(function () {
    return decrypt(this.notesEncrypted);
  })
  .set(function (val) {
    this.notesEncrypted = encrypt(val);
  });

/* ============================================================
   VALIDATION HOOKS
   ============================================================ */

// Валидация калибровки: если метод указан — должна быть
// заполнена соответствующая подструктура.
StudySchema.pre("validate", function (next) {
  const cal = this.calibration;
  if (!cal || !cal.method) return next(); // не откалибровано — ок

  if (cal.method === "ruler") {
    if (!cal.ruler) {
      return next(new Error("calibration.ruler is required when method=ruler"));
    }
    if (cal.interpupillary) {
      return next(
        new Error("calibration.interpupillary must be null when method=ruler"),
      );
    }
  } else if (cal.method === "interpupillary") {
    if (!cal.interpupillary) {
      return next(
        new Error(
          "calibration.interpupillary is required when method=interpupillary",
        ),
      );
    }
    if (cal.ruler) {
      return next(
        new Error("calibration.ruler must be null when method=interpupillary"),
      );
    }
  }

  next();
});

// Авто-обновление status при завершении калибровки
StudySchema.pre("save", function (next) {
  if (
    this.isModified("calibration") &&
    this.calibration?.isCalibrated &&
    this.status === "draft"
  ) {
    this.status = "calibrated";
  }
  next();
});

// Авто-проставление calibratedAt при первой успешной калибровке
StudySchema.pre("save", function (next) {
  if (
    this.isModified("calibration.isCalibrated") &&
    this.calibration?.isCalibrated &&
    !this.calibration.calibratedAt
  ) {
    this.calibration.calibratedAt = new Date();
  }
  next();
});

/* ============================================================
   INSTANCE METHODS
   ============================================================ */

// Готова ли сессия к разметке точек
StudySchema.methods.isReadyForAnnotation = function () {
  return (
    this.calibration?.isCalibrated === true &&
    this.isDeleted === false &&
    this.isArchived === false
  );
};

// Пересчёт нормализованных координат в миллиметры.
// Используется в measurement.service.js.
StudySchema.methods.pixelsToMm = function (pixels) {
  if (!this.calibration?.pixelsPerMm) {
    throw new Error("Study is not calibrated");
  }
  return pixels / this.calibration.pixelsPerMm;
};

/* ============================================================
   STATIC METHODS
   ============================================================ */

StudySchema.statics.findActive = function (filter = {}) {
  return this.find({ ...filter, isDeleted: false });
};

StudySchema.statics.findOneActive = function (filter = {}) {
  return this.findOne({ ...filter, isDeleted: false });
};

// Все сессии случая, отсортированные по дате (старые → новые)
StudySchema.statics.findByCaseTimeline = function (caseId) {
  return this.find({ caseId, isDeleted: false }).sort({ studyDate: 1 });
};

/* ============================================================
   INDEXES
   ============================================================ */

// Хронология случая (главный сценарий просмотра)
StudySchema.index({ caseId: 1, studyDate: -1, isDeleted: 1 });

// Активные сессии врача
StudySchema.index({ doctorUserId: 1, status: 1, isDeleted: 1 });

// Поиск pre_op / post_op для сравнения
StudySchema.index({ caseId: 1, studyType: 1, isDeleted: 1 });

/* ============================================================
   MODEL
   ============================================================ */

const Study =
  mongoose.models.Study ||
  mongoose.model("Study", StudySchema, "anthropometry_studies");

export default Study;
