import mongoose from "mongoose";

// Определение схемы для хранения информации о диагнозах пациентов
const DiagnosisSchema = new mongoose.Schema(
  {
    // XBT-код заболевания (уникальный международный классификатор болезней)
    xbt: {
      type: String,
      trim: true,
      required: true,
      unique: true, // Уникальный код диагноза
    },
    // Название диагноза
    title: {
      type: String,
      trim: true,
      required: true, // Название обязательно
    },
    // Подробное описание диагноза
    content: {
      type: String,
      trim: true, // Убираем пробелы в начале и конце
      required: true, // Поле обязательно
    },
    // Мета-описание для SEO
    metaDescription: {
      type: [String],
      default: [],
    },
    // Ключевые слова для SEO
    metaKeywords: {
      type: [String],
      default: [],
    },
    //Добавить дату постановки диагноза
    diagnosisDate: {
      type: Date,
      default: Date.now, // По умолчанию текущая дата
    },
    //Если диагноз может изменяться (например, сначала предварительный, потом подтвержденный)
    status: {
      type: String,
      enum: ["Preliminary", "Confirmed", "Chronic", "Resolved"],
      default: "Preliminary",
    },
  },
  {
    // Автоматически добавляет `createdAt` и `updatedAt`
    timestamps: true,
  }
);

// Создаем и экспортируем модель
const Diagnosis = mongoose.model("Diagnosis", DiagnosisSchema);

export default Diagnosis;
