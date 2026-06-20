// server/common/standards/labParameter.schema.js
//
// ОБЩАЯ ПОДСХЕМА ОДНОГО ЛАБ-ПОКАЗАТЕЛЯ (Вариант X).
// Один источник правды для структуры показателя — переиспользуется
// и новым LabResult (clinic-medical), и (при желании) старым LabTest.
//
// Нормализация value/unit/referenceRange по valueType живёт здесь же,
// поэтому оба контура получают одинаковое поведение «бесплатно».

import mongoose from "mongoose";
import { canonUnit } from "./labStandards.js";

const { Schema } = mongoose;

export const LAB_VALUE_TYPES = ["number", "text"];
export const LAB_FLAGS = [
  "normal",
  "high",
  "low",
  "critical_high",
  "critical_low",
  "abnormal",
];

const ReferenceRangeSchema = new Schema(
  {
    min: { type: Number, default: null },
    max: { type: Number, default: null },
    text: { type: String, default: null, trim: true }, // качественная норма
  },
  { _id: false },
);

export const LabParameterSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    loincCode: { type: String, default: null, trim: true }, // #1
    valueType: { type: String, enum: LAB_VALUE_TYPES, required: true },
    value: { type: Schema.Types.Mixed, required: true },
    unit: { type: String, default: "—", trim: true },
    referenceRange: { type: ReferenceRangeSchema, default: null },
    flag: { type: String, enum: LAB_FLAGS, default: "normal" }, // #2 (сохранённый)
  },
  { _id: false },
);

LabParameterSchema.pre("validate", function (next) {
  if (!this.name || !String(this.name).trim()) {
    return next(new Error("Lab parameter: name is required"));
  }

  if (this.valueType === "number") {
    const n = Number(this.value);
    if (!Number.isFinite(n)) {
      return next(
        new Error(`Lab parameter "${this.name}": value must be a number`),
      );
    }
    this.value = n;
    if (!this.unit || this.unit === "—") this.unit = "ед.";
    else this.unit = canonUnit(this.unit);

    if (!this.referenceRange)
      this.referenceRange = { min: null, max: null, text: null };
    const toNum = (v) => (v === "" || v == null ? null : Number(v));
    const minN = toNum(this.referenceRange.min);
    const maxN = toNum(this.referenceRange.max);
    this.referenceRange.min = Number.isFinite(minN) ? minN : null;
    this.referenceRange.max = Number.isFinite(maxN) ? maxN : null;
  } else if (this.valueType === "text") {
    const s = String(this.value ?? "").trim();
    if (!s) {
      return next(
        new Error(`Lab parameter "${this.name}": text value must not be empty`),
      );
    }
    this.value = s;
    this.unit = "—";
    if (
      this.referenceRange &&
      (this.referenceRange.min != null || this.referenceRange.max != null)
    ) {
      this.referenceRange.min = null;
      this.referenceRange.max = null;
    }
  } else {
    return next(new Error(`Lab parameter "${this.name}": invalid valueType`));
  }

  next();
});

export default LabParameterSchema;
