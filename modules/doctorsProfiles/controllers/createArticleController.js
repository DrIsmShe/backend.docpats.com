import Article from "../../../common/models/Articles/articles.js";
import Category from "../../../common/models/Articles/articlesCategories.js";
import mongoose from "mongoose";
import { uploadFile } from "../../../common/middlewares/uploadMiddleware.js"; // ⬅ Добавили
import { JSDOM } from "jsdom";
import createDOMPurify from "dompurify";

const window = new JSDOM("").window;
const DOMPurify = createDOMPurify(window);

const sanitizeStr = (v) =>
  typeof v === "string" ? DOMPurify.sanitize(v.trim()) : "";

const toStringArray = (v) => {
  if (Array.isArray(v))
    return v.map((x) => sanitizeStr(String(x))).filter(Boolean);

  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v);
      if (Array.isArray(parsed))
        return parsed.map(String).map(sanitizeStr).filter(Boolean);
    } catch {}
    return v.split(",").map(sanitizeStr).filter(Boolean);
  }

  return [];
};

const toBoolean = (v) => {
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const s = v.toLowerCase().trim();
    return ["true", "1", "yes", "on"].includes(s);
  }
  return false;
};

const sanitizeHtml = (html) =>
  typeof html === "string" ? DOMPurify.sanitize(html) : "";

export const createArticleController = async (req, res) => {
  try {
    if (!req.session?.userId)
      return res.status(403).json({ message: "Please sign in." });

    const userId = req.session.userId;

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

    const safeTitle = sanitizeStr(title);
    const safeContent = sanitizeHtml(content);

    if (!safeTitle || !safeContent)
      return res
        .status(400)
        .json({ message: "Title and content are required." });

    if (!mongoose.Types.ObjectId.isValid(category))
      return res.status(400).json({ message: "Invalid category id." });

    const categoryExists = await Category.findById(category);
    if (!categoryExists)
      return res.status(400).json({ message: "Category does not exist." });

    // === IMAGE FIX (главное исправление) ===
    let imageUrl = "";
    if (req.file) {
      imageUrl = await uploadFile(req.file); // ⬅ теперь всегда корректный URL
    }

    const newArticle = new Article({
      title: safeTitle,
      content: safeContent,
      abstract,
      authors: sanitizeStr(authors),
      references: sanitizeStr(references),
      tags: toStringArray(tags),
      metaDescription: toStringArray(metadesc),
      metaKeywords: toStringArray(metakeywords),
      isPublished: toBoolean(isPublished),
      authorId: userId,
      category,
      imageUrl,
    });

    const saved = await newArticle.save();

    return res.status(201).json({
      message: "Article created",
      article: saved,
    });
  } catch (error) {
    console.error("❌ createArticle error:", error);
    return res.status(500).json({
      message: "Server error",
      error: error?.message,
    });
  }
};
