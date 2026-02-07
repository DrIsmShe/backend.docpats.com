import mongoose from "mongoose";

/**
 * 🩻 Шаблон заключения рентгеновского исследования
 */
const templateXRayScanSchema = new mongoose.Schema(
  {
    doctor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    content: {
      type: String,
      required: true,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

/**
 * 🧩 Безопасная регистрация модели
 * Устраняет ошибку "Cannot overwrite model once compiled"
 */
const XRayScanTemplateReport =
  mongoose.models.XRayScanTemplateReport ||
  mongoose.model("XRayScanTemplateReport", templateXRayScanSchema);

export default XRayScanTemplateReport;
