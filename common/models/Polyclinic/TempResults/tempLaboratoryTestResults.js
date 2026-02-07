// Импортируем mongoose для создания схемы
import mongoose from "mongoose";

// Определяем схему для шаблона лабораторных тестов
const tempLaboratoryTestResults = new mongoose.Schema(
  {
    // Название шаблона лабораторного теста
    title: {
      type: String, // Тип данных строка
      required: true, // Поле обязательно для заполнения
      trim: true, // Убирает лишние пробелы в начале и конце строки
      minlength: [3, "Title must be at least 3 characters long"], // Минимальная длина заголовка
      unique: true, // Заголовок должен быть уникальным
      index: true, // Индекс для быстрого поиска
    },
    // Содержимое шаблона лабораторного теста
    content: {
      type: String, // Тип данных строка
      required: true, // Поле обязательно для заполнения
      trim: true, // Убирает лишние пробелы
      minlength: [10, "Content must be at least 10 characters long"], // Минимальная длина содержимого
    },
    // Пользователь, создавший шаблон
    createdBy: {
      type: mongoose.Schema.Types.ObjectId, // Ссылка на документ пользователя
      ref: "User", // Указывает модель, на которую ссылается
      required: true, // Поле обязательно
    },
    // Теги для классификации шаблона
    tags: {
      type: [String], // Массив строк
      default: [], // Пустой массив по умолчанию
    },
    // Статус активности шаблона
    isActive: {
      type: Boolean, // Логическое значение
      default: true, // По умолчанию шаблон активен
    },
    // Дата создания записи
    createdAt: {
      type: Date, // Тип данных дата
      default: Date.now, // Текущее время по умолчанию
    },
    // Дата последнего обновления записи
    updatedAt: {
      type: Date, // Тип данных дата
      default: Date.now, // Текущее время по умолчанию
    },
  },
  {
    timestamps: true, // Автоматически добавляет поля createdAt и updatedAt
  }
);

// Middleware для обновления поля updatedAt перед сохранением
tempLaboratoryTestResults.pre("save", function (next) {
  this.updatedAt = Date.now(); // Обновляем поле updatedAt текущей датой
  next(); // Продолжаем выполнение
});

// Создаем метод для поиска по частям заголовка (если нужно)
tempLaboratoryTestResults.methods.findByTitle = function (title) {
  return this.model("TempLaboratoryTestResults").find({
    title: new RegExp(title, "i"), // Нахождение по регулярному выражению (нечувствительно к регистру)
  });
};

// Создаём и экспортируем модель лабораторных тестов
const TempLaboratoryTestResults = mongoose.model(
  "TempLaboratoryTestResults",
  tempLaboratoryTestResults
);

export default TempLaboratoryTestResults;
