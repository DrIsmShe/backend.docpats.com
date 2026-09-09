import mongoose from "mongoose";

const categorySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      unique: true, // уникальное имя категории
      trim: true,
    },
    // Название на пяти языках. name остаётся исходным — по нему рубрика
    // уникальна и по нему её ищут в админке; title добавляет переводы для
    // показа. Пустой язык означает «перевода нет», и интерфейс покажет
    // исходное название: пустота честнее подделки.
    title: {
      ru: { type: String, trim: true, default: "" },
      en: { type: String, trim: true, default: "" },
      az: { type: String, trim: true, default: "" },
      tr: { type: String, trim: true, default: "" },
      ar: { type: String, trim: true, default: "" },
    },
    description: {
      type: String,
      default: "", // краткое описание категории
    },
    slug: {
      type: String,
      unique: true, // уникальный слаг для SEO и удобства навигации
      trim: true,
    },
    parentCategory: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category", // ссылка на родительскую категорию для организации иерархии
      default: null,
    },
    childCategories: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Category", // массив дочерних категорий, связанных с текущей категорией
      },
    ],
    isActive: {
      type: Boolean,
      default: true, // состояние категории (активна или нет)
    },
    icon: {
      type: String,
      default: "", // ссылка на иконку или изображение категории
    },
    metaDescription: {
      type: String,
      default: "", // мета-описание для SEO
      trim: true,
    },
    metaKeywords: {
      type: [String], // массив ключевых слов для SEO
      default: [],
    },
    createdAt: {
      type: Date,
      default: Date.now, // дата создания категории
    },
    updatedAt: {
      type: Date,
      default: Date.now, // дата последнего обновления категории
    },
  },
  {
    timestamps: true, // автоматическое обновление полей createdAt и updatedAt
  }
);

// Middleware для обновления поля updatedAt перед каждым сохранением
categorySchema.pre("save", function (next) {
  this.updatedAt = Date.now();
  next();
});

// Создаем и экспортируем модель категории
const Category = mongoose.model("Category", categorySchema);

export default Category;
