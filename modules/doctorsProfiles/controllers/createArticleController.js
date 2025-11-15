import Article from "../../../common/models/Articles/articles.js";
import Category from "../../../common/models/Articles/articlesCategories.js";
import mongoose from "mongoose";
import { JSDOM } from "jsdom";
import createDOMPurify from "dompurify";

// DOMPurify для серверной стороны
const window = new JSDOM("").window;
const DOMPurify = createDOMPurify(window);

// ===== helpers =====
const sanitizeStr = (v) =>
  typeof v === "string" ? DOMPurify.sanitize(v.trim()) : "";

/**
 * Принимает значение из req.body и возвращает массив строк.
 * Поддерживает:
 *  - JSON-строку: '["a","b"]'
 *  - CSV-строку:  'a, b, c'
 *  - Уже массив:  ["a","b"]
 */
const toStringArray = (v) => {
  if (Array.isArray(v)) {
    return v.map((x) => sanitizeStr(String(x))).filter((x) => x.length > 0);
  }
  if (typeof v === "string") {
    // Пытаемся JSON.parse
    try {
      const parsed = JSON.parse(v);
      if (Array.isArray(parsed)) {
        return parsed
          .map((x) => sanitizeStr(String(x)))
          .filter((x) => x.length > 0);
      }
    } catch {
      // не JSON — трактуем как CSV
      return v
        .split(",")
        .map((x) => sanitizeStr(x))
        .filter((x) => x.length > 0);
    }
  }
  return [];
};

const toBoolean = (v) => {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const s = v.toLowerCase().trim();
    return s === "true" || s === "1" || s === "yes" || s === "on";
  }
  return false;
};

// Позволяем безопасный HTML для контента (CKEditor)
const sanitizeHtml = (html) =>
  typeof html === "string" ? DOMPurify.sanitize(html) : "";

// ===== controller =====
const createArticleController = async (req, res) => {
  try {
    // 1) Аутентификация
    if (!req.session?.userId) {
      return res.status(403).json({ message: "Please sign in." });
    }
    const userId = req.session.userId;

    // 2) Извлекаем поля
    const {
      title,
      content,
      abstract,
      tags,
      isPublished,
      authors,
      references,
      metadesc,
      metakeywords,
      category,
    } = req.body;

    // 3) Проверка обязательных
    const safeTitle = sanitizeStr(title);
    const safeContent = sanitizeHtml(content);
    if (!safeTitle || !safeContent) {
      return res
        .status(400)
        .json({ message: "Title and content are required." });
    }

    // 4) Категория
    if (!category) {
      return res.status(400).json({ message: "Category not specified." });
    }
    if (!mongoose.Types.ObjectId.isValid(category)) {
      return res.status(400).json({ message: "Invalid category id." });
    }
    const categoryExists = await Category.findById(category).lean();
    if (!categoryExists) {
      return res.status(400).json({ message: "Category does not exist." });
    }

    // 5) Необязательные поля
    const safeAuthors = sanitizeStr(authors); // можно пусто
    const safeReferences = sanitizeStr(references); // можно пусто

    // 6) Массивы (схема ожидает массивы строк)
    const safeTags = toStringArray(tags);
    const safeMetaDesc = toStringArray(metadesc);
    const safeMetaKeywords = toStringArray(metakeywords);

    // 7) Булево
    const safeIsPublished = toBoolean(isPublished);

    // 8) Картинка
    // Если используете прокси/другое окружение — можно собрать origin динамически
    const imageUrl = req.file
      ? `${req.protocol}://${req.get("host")}/uploads/${req.file.filename}`
      : "";

    // 9) Лог входящих
    console.log("Creating article with:", {
      title: safeTitle,
      contentLength: safeContent.length,
      abstract,
      tags: safeTags,
      authors: safeAuthors,
      references: safeReferences,
      isPublished: safeIsPublished,
      metaDescription: safeMetaDesc,
      metaKeywords: safeMetaKeywords,
      category,
      authorId: userId,
      imageUrl,
    });

    // 10) Создание и сохранение
    const newArticle = new Article({
      title: safeTitle,
      content: safeContent,
      abstract,
      authors: safeAuthors, // String (optional)
      references: safeReferences, // String (optional)
      tags: safeTags, // [String]
      metaDescription: safeMetaDesc, // [String] — соответствует схеме
      metaKeywords: safeMetaKeywords, // [String] — соответствует схеме
      isPublished: safeIsPublished,
      authorId: userId,
      category,
      imageUrl,
    });

    const savedArticle = await newArticle.save();

    return res.status(201).json({
      message: "Article created successfully.",
      article: savedArticle,
    });
  } catch (error) {
    console.error("Error creating article:", error);
    return res.status(500).json({
      message: "An error occurred while creating the article.",
      error: error?.message || "Unknown error",
    });
  }
};

export default createArticleController;
