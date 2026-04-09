import mongoose from "mongoose";
import ArticleScine from "../models/Articles/articles-scince.js";
import User from "../models/Auth/users.js";
import { getOrCreateTranslation } from "../../modules/translation/translation.service.js";
import { markTranslationsAsStale } from "../../modules/translation/translation.repository.js";
import { getTranslationIfExists } from "../../modules/translation/translation.service.js";

const buildAuthorPublic = (authorId) => {
  if (!authorId) return null;
  if (typeof authorId.decryptFields === "function") {
    const dec = authorId.decryptFields();
    return {
      _id: authorId._id,
      username: authorId.username,
      role: authorId.role,
      avatar: authorId.avatar,
      firstName: dec.firstName ?? null,
      lastName: dec.lastName ?? null,
    };
  }
  return {
    _id: authorId._id,
    username: authorId.username,
    role: authorId.role,
    avatar: authorId.avatar,
    firstName: authorId.firstName ?? null,
    lastName: authorId.lastName ?? null,
  };
};

export const getArticleScineById = async (req, res) => {
  try {
    const article = await ArticleScine.findById(req.params.id)
      .populate({
        path: "authorId",
        model: User,
        select:
          "username role avatar firstNameEncrypted lastNameEncrypted firstName lastName",
      })
      .exec();

    if (!article || !article.isPublished) {
      return res.status(404).json({ message: "Not found" });
    }

    const targetLanguage =
      req.language ||
      req.headers["accept-language"]?.split(",")[0]?.split("-")[0] ||
      "en";

    let localized = null;
    try {
      localized = await getOrCreateTranslation({
        entity: article,
        entityType: "ArticleScine",
        targetLanguage,
      });
    } catch (translationError) {
      console.error("⚠️ Translation error:", translationError.message);
    }

    const title = localized?.title ?? article.title;
    const content = localized?.content ?? article.content;
    const abstract = localized?.abstract ?? article.abstract ?? "";
    const displayedLanguage =
      localized?.displayedLanguage ?? article.originalLanguage ?? "en";
    const isOriginal = localized?.isOriginal ?? true;
    const isAutoTranslated = localized?.isAutoTranslated ?? false;

    res.json({
      success: true,
      data: {
        _id: article._id,

        title,
        content,
        abstract,

        originalContent: article.content,
        originalLanguage: article.originalLanguage,

        displayedLanguage,
        isOriginal,
        isAutoTranslated,
        translatedFrom: localized?.translatedFrom ?? null,

        authors: article.authors,
        references: article.references,
        imageUrl: article.imageUrl,
        createdAt: article.createdAt,
        category: article.category,
        likes: article.likes,
        tags: article.tags,
        isPublished: article.isPublished,

        authorId: article.authorId,
        authorPublic: buildAuthorPublic(article.authorId),
      },
    });
  } catch (e) {
    console.error("🔥 getArticleScineById error:", e);
    res.status(500).json({ error: e.message });
  }
};

export const updateArticleScine = async (req, res) => {
  try {
    const article = await ArticleScine.findById(req.params.id);
    if (!article) return res.status(404).json({ message: "Not found" });

    const { title, content, abstract } = req.body;

    const mustInvalidate =
      (title !== undefined && title !== article.title) ||
      (content !== undefined && content !== article.content) ||
      (abstract !== undefined && abstract !== article.abstract);

    if (title !== undefined) article.title = title;
    if (content !== undefined) article.content = content;
    if (abstract !== undefined) article.abstract = abstract;
    if (mustInvalidate) article.translationVersion += 1;

    await article.save();

    if (mustInvalidate) {
      await markTranslationsAsStale({
        entityId: article._id,
        entityType: "ArticleScine",
      });
    }

    res.json({ success: true, article });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

export const getArticleScineList = async (req, res) => {
  try {
    const articles = await ArticleScine.find({ isPublished: true })
      .sort({ createdAt: -1 })
      .limit(20);

    const result = await Promise.all(
      articles.map(async (article) => {
        const localized = await getTranslationIfExists({
          entity: article,
          entityType: "ArticleScine",
          targetLanguage: req.language,
        });
        return {
          _id: article._id,
          title: localized.title,
          abstract: localized.abstract,
          createdAt: article.createdAt,
          displayedLanguage: localized.displayedLanguage,
          isOriginal: localized.isOriginal,
        };
      }),
    );

    res.json({ articles: result });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
