import mongoose from "mongoose";

/**
 * 📋 Схема хронических заболеваний пациента в поликлинике
 */
const chronicDiseasesPatientSchema = new mongoose.Schema(
  {
    /**
     * 🔗 ID пациента
     * (если пациент может иметь несколько записей, можно оставить массив [])
     */
    patientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "NewPatientPolyclinic",
      required: true,
    },

    /**
     * 👨‍⚕️ Ссылка на лечащего врача
     */
    doctorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    /**
     * 🧠 Описание хронического заболевания
     */
    content: {
      type: String,
      trim: true,
      required: true,
    },
  },
  {
    timestamps: true, // ⏰ createdAt и updatedAt
  }
);

/**
 * ⚡ Индексы для оптимизации поиска
 * (если понадобится поиск по пациенту и контенту)
 */
chronicDiseasesPatientSchema.index({ patientId: 1, doctorId: 1 });
chronicDiseasesPatientSchema.index({ content: "text" });

/**
 * 🧩 Безопасная регистрация модели:
 * если уже зарегистрирована — повторно не создаём
 */
const chronicDiseasesPatient =
  mongoose.models.chronicDiseasesPatient ||
  mongoose.model("chronicDiseasesPatient", chronicDiseasesPatientSchema);

export default chronicDiseasesPatient;
