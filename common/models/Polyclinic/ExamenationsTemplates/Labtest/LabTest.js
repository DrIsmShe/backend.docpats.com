import mongoose from "mongoose";

/* ---------- Подсхемы ---------- */
const ReferenceRangeSchema = new mongoose.Schema(
  {
    min: { type: Number, default: null },
    max: { type: Number, default: null },
  },
  { _id: false }
);

const TestParameterSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true }, // Название показателя
    valueType: { type: String, enum: ["number", "text"], required: true },
    value: { type: mongoose.Schema.Types.Mixed, required: true }, // Число или текст
    unit: { type: String, default: "—", trim: true }, // Ед. изм. (для текста — "—")
    referenceRange: { type: ReferenceRangeSchema, default: null }, // Для чисел
  },
  { _id: false }
);

// Гарантируем согласованность value/unit/referenceRange по valueType
TestParameterSchema.pre("validate", function (next) {
  // name
  if (!this.name || !String(this.name).trim()) {
    return next(
      new mongoose.Error.ValidationError(
        new mongoose.Error.ValidatorError({
          path: "name",
          message: "Укажите название показателя",
          value: this.name,
        })
      )
    );
  }

  // value + valueType
  if (this.valueType === "number") {
    const n = Number(this.value);
    if (!Number.isFinite(n)) {
      return next(
        new mongoose.Error.ValidationError(
          new mongoose.Error.ValidatorError({
            path: "value",
            message: `Показатель «${this.name}» должен быть числом`,
            value: this.value,
          })
        )
      );
    }
    this.value = n;

    // ед.изм. по умолчанию для числовых значений
    if (!this.unit || this.unit === "—") this.unit = "ед.";

    // referenceRange обязателен как объект, но min/max могут быть null
    if (!this.referenceRange) this.referenceRange = { min: null, max: null };

    // приведение min/max если заданы строкой
    const toNum = (v) => (v === "" || v == null ? null : Number(v));
    if (this.referenceRange) {
      const { min, max } = this.referenceRange;
      const minN = toNum(min);
      const maxN = toNum(max);
      if (minN !== null && !Number.isFinite(minN))
        this.referenceRange.min = null;
      else this.referenceRange.min = minN;
      if (maxN !== null && !Number.isFinite(maxN))
        this.referenceRange.max = null;
      else this.referenceRange.max = maxN;
    }
  } else if (this.valueType === "text") {
    const s = String(this.value ?? "").trim();
    if (!s) {
      return next(
        new mongoose.Error.ValidationError(
          new mongoose.Error.ValidatorError({
            path: "value",
            message: `Показатель «${this.name}» должен быть текстом (не пустым)`,
            value: this.value,
          })
        )
      );
    }
    this.value = s;
    // для текста единица измерения не нужна
    this.unit = "—";
    this.referenceRange = null;
  } else {
    return next(
      new mongoose.Error.ValidationError(
        new mongoose.Error.ValidatorError({
          path: "valueType",
          message: `Некорректный valueType у «${this.name}». Разрешено: number | text`,
          value: this.valueType,
        })
      )
    );
  }

  next();
});

/* ---------- Комментарии врача ---------- */
const DoctorCommentSchema = new mongoose.Schema(
  {
    doctor: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    text: { type: String },
    date: { type: Date, default: Date.now }, // оставляем "date", чтобы не ломать текущий код
  },
  { _id: false }
);

/* ---------- Основная схема ---------- */
const LabTestSchema = new mongoose.Schema(
  {
    patient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "NewPatientPolyclinic",
      required: true,
    },
    doctor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    date: { type: Date, default: Date.now },

    // Тип теста
    testType: {
      type: String,
      enum: [
        "BloodTestGeneral", // Общий анализ крови
        "BloodTestBiochemistry", // Биохимия
        "UrineTest", // Анализ мочи
        "StoolTest", // Анализ кала
        "HormonePanel", // Гормоны
        "TumorMarkers", // Онкомаркеры
        "PCR", // ПЦР
        "Immunology", // Иммунология/ИФА
        "GeneticScreening", // Генетический скрининг
        "Other",
      ],
      required: true,
      trim: true,
    },

    // Показатели
    testParameters: {
      type: [TestParameterSchema],
      default: [],
      validate: {
        validator: (arr) => Array.isArray(arr) && arr.length > 0,
        message: "Добавьте хотя бы один показатель анализа",
      },
    },

    report: { type: String }, // Заключение врача
    diagnosis: { type: String }, // Предположительный диагноз

    relatedStudies: [
      { type: mongoose.Schema.Types.ObjectId, ref: "ImagingStudy" },
    ],

    rawData: { type: String }, // Сырой ответ (XML/PDF в base64 и т.п.)
    labName: { type: String }, // Название лаборатории

    labTechnician: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Technician",
    },

    files: [{ type: mongoose.Schema.Types.ObjectId, ref: "File" }],

    // AI-анализ (опционально)
    aiAnalysis: {
      findings: { type: mongoose.Schema.Types.Mixed, default: null },
      confidence: { type: Number, min: 0, max: 1, default: null },
      version: { type: String, default: null },
      prediction: { type: String, default: null },
      predictionConfidence: { type: Number, min: 0, max: 1, default: null },
      processingTime: { type: Number, default: null }, // в секундах
      processedAt: { type: Date, default: null },
    },

    // Подтверждение
    validatedByDoctor: { type: Boolean, default: false },
    doctorNotes: { type: String },

    // Риск
    riskLevel: {
      type: String,
      enum: ["low", "medium", "high"],
      default: undefined,
    },
    riskFactors: { type: [String], default: [] },

    doctorComments: [DoctorCommentSchema],
  },
  { timestamps: true }
);

/* ---------- Экспорт ---------- */
export default mongoose.models.LabTest ||
  mongoose.model("LabTest", LabTestSchema);
