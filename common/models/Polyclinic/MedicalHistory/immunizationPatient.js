import mongoose from "mongoose";

/**
 * 💉 Схема иммунизации пациента в поликлинике
 */
const immunizationPatientSchema = new mongoose.Schema(
  {
    /**
     * 🔗 ID пациента (если пациент может иметь несколько записей)
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
     * 💊 Название вакцины или иммунизации
     */
    vaccineName: {
      type: String,
      trim: true,
      required: true,
    },

    /**
     * 📅 Дата проведения иммунизации
     */
    dateGiven: {
      type: Date,
      default: Date.now,
    },

    /**
     * 🧾 Дополнительное описание или комментарии
     */
    content: {
      type: String,
      trim: true,
      default: "",
    },
  },
  {
    timestamps: true, // ⏰ createdAt, updatedAt
  }
);

/**
 * ⚡ Индексы для быстрого поиска по пациенту и врачу
 */
immunizationPatientSchema.index({ patientId: 1, doctorId: 1 });
immunizationPatientSchema.index({ vaccineName: "text" });

/**
 * 🧩 Безопасная регистрация модели:
 * предотвращает ошибку "Cannot overwrite model once compiled"
 */
const immunizationPatient =
  mongoose.models.immunizationPatient ||
  mongoose.model("immunizationPatient", immunizationPatientSchema);

export default immunizationPatient;
