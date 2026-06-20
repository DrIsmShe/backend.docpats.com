// server/modules/clinic/clinic-medical/models/labResult.model.js
//
// LAB RESULT (clinic-medical, multi-tenant). Вариант X:
// структура показателя берётся из ОБЩЕЙ подсхемы (common/standards), а не
// дублируется здесь — один источник правды для обоих контуров.
//
// Мост идентичен Prescription:
//   patientRef = ClinicPatient, createdByClinicId, createdBy XOR createdByEmployee,
//   PHI plaintext, consent-scope "encounters", sharedWith[].
//
// Стандарты (Корзина 1): LOINC на показатель, сохранённый flag, status FSM,
// effectiveDateTime, reference.text. Готово под графики динамики (#7).

import mongoose from "mongoose";
import LabParameterSchema from "../../../../common/standards/labParameter.schema.js";

const { Schema } = mongoose;

export const LAB_STATUSES = ["preliminary", "final", "corrected", "amended"];

export const LAB_PANEL_TYPES = [
  "BloodTestGeneral",
  "BloodTestBiochemistry",
  "UrineTest",
  "StoolTest",
  "HormonePanel",
  "TumorMarkers",
  "PCR",
  "Immunology",
  "GeneticScreening",
  "CoagulationPanel",
  "LipidProfile",
  "LiverFunction",
  "RenalElectrolytes",
  "IronStudies",
  "DiabetesPanel",
  "ThyroidPanel",
  "CardiacMarkers",
  "VitaminsTrace",
  "InfectiousSerology",
  "UrineAlbuminACR",
  "StoolInflammation",
  "Other",
];

const LabCommentSchema = new Schema(
  {
    authorUser: { type: Schema.Types.ObjectId, ref: "User", default: null },
    authorEmployee: { type: Schema.Types.ObjectId, default: null },
    text: { type: String, trim: true },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const LabResultSchema = new Schema(
  {
    // ── Мост (как Prescription) ──
    patientRef: {
      type: Schema.Types.ObjectId,
      ref: "ClinicPatient",
      required: true,
      index: true,
    },
    patientTypeModel: {
      type: String,
      default: "ClinicPatient",
      enum: ["ClinicPatient"],
    },
    createdByClinicId: {
      type: Schema.Types.ObjectId,
      ref: "Clinic",
      required: true,
      index: true,
    },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    createdByEmployee: { type: Schema.Types.ObjectId, default: null },

    encounterId: {
      type: Schema.Types.ObjectId,
      ref: "Encounter",
      default: null,
    },

    // ── Классификация ──
    panelType: { type: String, required: true, trim: true, default: "Other" },
    panelTitle: { type: String, default: null, trim: true },

    // ── Стандарты ──
    status: {
      type: String,
      enum: LAB_STATUSES,
      default: "final",
      index: true,
    },
    effectiveDateTime: { type: Date, default: Date.now }, // дата забора

    // ── Показатели (общая подсхема) ──
    parameters: { type: [LabParameterSchema], default: [] },

    // ── Заключение / диагноз ──
    report: { type: String, default: "", trim: true },
    diagnosis: {
      code: { type: String, default: "", trim: true },
      codeTitle: { type: String, default: "", trim: true },
      text: { type: String, default: "", trim: true },
    },

    labName: { type: String, default: "", trim: true },

    // ── Прикреплённый файл оригинала (R2) ──
    attachedFile: {
      key: { type: String, default: null },
      url: { type: String, default: null },
      fileName: { type: String, default: null },
      mimeType: { type: String, default: null },
      size: { type: Number, default: null },
      uploadedAt: { type: Date, default: null },
    },

    comments: { type: [LabCommentSchema], default: [] },
    sharedWith: [{ type: Schema.Types.ObjectId, ref: "Clinic" }],
  },
  { timestamps: true },
);

LabResultSchema.index({ patientRef: 1, effectiveDateTime: -1 });
LabResultSchema.index({ patientRef: 1, panelType: 1, effectiveDateTime: -1 });
LabResultSchema.index({ createdByClinicId: 1, createdAt: -1 });

// XOR авторства (как Prescription)
LabResultSchema.pre("validate", function (next) {
  const hasUser = !!this.createdBy;
  const hasEmp = !!this.createdByEmployee;
  if (hasUser === hasEmp) {
    return next(
      new Error(
        "LabResult: exactly one of createdBy (User) or createdByEmployee must be set",
      ),
    );
  }
  next();
});

export default mongoose.models.LabResult ||
  mongoose.model("LabResult", LabResultSchema);
