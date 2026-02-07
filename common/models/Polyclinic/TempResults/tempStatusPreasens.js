import mongoose from "mongoose";

// Определяем схему для шаблона статуса презенции
const tempStatusPreasens = new mongoose.Schema(
  {
    // Название шаблона статуса презенции
    title: {
      type: String, // Тип данных строка
      required: true, // Поле обязательно для заполнения
      trim: true, // Убирает лишние пробелы в начале и конце строки
      minlength: [3, "Title must be at least 3 characters long"], // Минимальная длина заголовка
      unique: true, // Заголовок должен быть уникальным
      index: true, // Индекс для быстрого поиска
    },
    // Содержимое шаблона статуса презенции
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
tempStatusPreasens.pre("save", function (next) {
  this.updatedAt = Date.now(); // Обновляем поле updatedAt текущей датой
  next(); // Продолжаем выполнение
});

// Метод для поиска по частям заголовка (поиск без учета регистра)
tempStatusPreasens.methods.findByTitle = function (title) {
  return this.model("TempStatusPreasens").find({
    title: new RegExp(title, "i"), // Используем регулярное выражение для поиска по части заголовка
  });
};

// Статический метод для поиска по тегам
tempStatusPreasens.statics.findByTags = function (tags) {
  return this.find({
    tags: { $in: tags }, // Ищем шаблоны, в которых есть хотя бы один из указанных тегов
  });
};

// Создаем и экспортируем модель шаблона статуса презенции
const TempStatusPreasens = mongoose.model(
  "TempStatusPreasens",
  tempStatusPreasens
);

export default TempStatusPreasens;
