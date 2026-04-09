// Импортируем mongoose для создания схемы
import mongoose from "mongoose";

// Определяем схему для шаблона результатов КТ
const tempCTScanResultsSchema = new mongoose.Schema(
  {
    // Название шаблона
    title: {
      type: String, // Тип данных строка
      required: true, // Поле обязательно для заполнения
      trim: true, // Убирает лишние пробелы в начале и конце строки
    },
    // Содержимое шаблона
    content: {
      type: String, // Тип данных строка
      required: true, // Поле обязательно для заполнения
      trim: true, // Убирает лишние пробелы
    },
    // Пользователь, создавший шаблон
    createdBy: {
      type: mongoose.Schema.Types.ObjectId, // Ссылка на документ пользователя
      ref: "User", // Указывает модель, на которую ссылается
      required: true, // Поле обязательно
    },
    // Теги для классификации
    tags: {
      type: [String], // Массив строк
      default: [], // Пустой массив по умолчанию
    },
    // Статус активности шаблона
    isActive: {
      type: Boolean, // Логическое значение
      default: true, // По умолчанию шаблон активен
    },
    // Дата создания
    createdAt: {
      type: Date, // Тип данных дата
      default: Date.now, // Текущее время по умолчанию
    },
    // Дата последнего обновления
    updatedAt: {
      type: Date, // Тип данных дата
      default: Date.now, // Текущее время по умолчанию
    },
  },
  {
    timestamps: true, // Автоматически добавляет createdAt и updatedAt
  }
);

const TempCTScanResults =
  mongoose.models.TempCTScanResults ||
  mongoose.model("TempCTScanResults", tempCTScanResultsSchema);

export default TempCTScanResults;
