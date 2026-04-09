import mongoose from "mongoose";

const articleSchema = new mongoose.Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
    },
    content: {
      type: String,
      required: true,
    },
    abstract: {
      type: String,
      required: false,
    },

    tags: {
      type: [String],
      default: [],
    },
    metaDescription: {
      type: [String],
      default: [],
    },
    metaKeywords: {
      type: [String],
      default: [],
    },
    isPublished: {
      type: Boolean,
      default: false,
    },
    authorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false, // можно не указывать авторов
    },
    originalLanguage: {
      type: String,
      enum: ["en", "ru", "az", "tr", "ar"],
      required: true,
      default: "en",
      index: true,
    },

    translationVersion: {
      type: Number,
      default: 1,
    },
    authors: {
      type: String,
      required: false,
    },
    references: {
      type: String,
      required: false,
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
    updatedAt: {
      type: Date,
      default: Date.now,
    },
    views: {
      type: Number,
      default: 0,
    },
    likes: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],
    imageUrl: {
      type: String,
    },
    category: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Category",
    },
    readTime: {
      type: Number,
      default: 0,
    },
  },
  {
    timestamps: true, // Автоматически обновляет поля createdAt и updatedAt
  },
);

// Middleware для обновления поля updatedAt перед сохранением
articleSchema.pre("save", function (next) {
  this.updatedAt = Date.now();
  next();
});
articleSchema.index({ title: "text", content: "text", tags: "text" });
// Создаем модель только один раз: если уже существует — используем существующую, иначе создаем новую.
const Article =
  mongoose.models.Article || mongoose.model("Article", articleSchema);

export default Article;
