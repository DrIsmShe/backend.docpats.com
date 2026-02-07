import mongoose from "mongoose";

// Определение схемы для хранения информации о пациенте в поликлинике
const allergiesPatientSchema = new mongoose.Schema(
  {
    // ID пациента (если пациент может иметь несколько записей, оставь массив [])
    patientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "NewPatientPolyclinic",
      required: true,
    },
    // Ссылка на лечащего врача
    doctorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    // Описание аллергии
    content: {
      type: String,
      trim: true,
      required: true,
    },
  },
  {
    // Автоматическое добавление createdAt и updatedAt
    timestamps: true,
  }
);

// Создаем и экспортируем модель
const allergiesPatientModel = mongoose.model(
  "AllergiesPatient",
  allergiesPatientSchema
);

export default allergiesPatientModel;
