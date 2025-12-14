import mongoose from "mongoose";

// ==========================
// 🩻 Шаблон "Название исследования" для рентгена (XRay)
// ==========================
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
  { timestamps: true }
);

// ==========================
// ✅ Безопасная регистрация модели
// ==========================
// Убираем лишний пробел и предотвращаем ошибку OverwriteModelError
const XRayScanTemplateNameofexam =
  mongoose.models.XRayScanTemplateNameofexam ||
  mongoose.model("XRayScanTemplateNameofexam", templateXRayScanSchema);

export default XRayScanTemplateNameofexam;
