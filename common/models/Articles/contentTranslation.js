import mongoose from "mongoose";

const contentTranslationSchema = new mongoose.Schema(
  {
    entityId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },

    entityType: {
      type: String,
      enum: ["Article", "ArticleScine"],
      required: true,
      index: true,
    },

    language: {
      type: String,
      enum: ["en", "ru", "az", "tr", "ar"],
      required: true,
      index: true,
    },

    title: {
      type: String,
      required: true,
      default: "",
    },

    content: {
      type: String,
      required: true,
      default: "",
    },

    abstract: {
      type: String,
      default: "",
    },

    translatedFrom: {
      type: String,
      enum: ["en", "ru", "az", "tr", "ar"],
      required: true,
    },

    translationProvider: {
      type: String,
      default: "openai",
    },

    translationMethod: {
      type: String,
      enum: ["ai_auto", "human", "author_reviewed"],
      default: "ai_auto",
    },

    isAutoTranslated: {
      type: Boolean,
      default: true,
    },

    isReviewed: {
      type: Boolean,
      default: false,
      index: true,
    },

    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    reviewedAt: {
      type: Date,
      default: null,
    },

    sourceVersion: {
      type: Number,
      required: true,
    },

    isStale: {
      type: Boolean,
      default: false,
      index: true,
    },

    lastTranslatedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true },
);

contentTranslationSchema.index(
  { entityId: 1, entityType: 1, language: 1 },
  { unique: true },
);

const ContentTranslation =
  mongoose.models.ContentTranslation ||
  mongoose.model("ContentTranslation", contentTranslationSchema);

export default ContentTranslation;
