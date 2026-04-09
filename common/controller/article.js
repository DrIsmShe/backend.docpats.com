import Article from "../../common/models/Articles/articles.js";
import { getOrCreateTranslation } from "../../modules/translation/translation.service.js";
import { markTranslationsAsStale } from "../../modules/translation/translation.repository.js";

import { getTranslationIfExists } from "../../modules/translation/translation.service.js";
export const getMyArticleSingle = async (req, res) => {
  try {
    const article = await Article.findById(req.params.id).populate(
      "authorId",
      "firstName lastName",
    );

    if (!article) {
      return res.status(404).json({
        success: false,
        message: "Article not found",
      });
    }

    console.log("🌍 requested language:", req.language);

    const localized = await getOrCreateTranslation({
      entity: article,
      entityType: "Article",
      targetLanguage: req.language || "en",
    });

    console.log("📦 localized:", localized);

    return res.status(200).json({
      success: true,
      data: {
        _id: article._id,

        title: localized.title,
        content: localized.content,
        abstract: localized.abstract,

        originalContent: article.content,
        originalLanguage: article.originalLanguage,

        displayedLanguage: localized.displayedLanguage,
        isOriginal: localized.isOriginal,
        isAutoTranslated: localized.isAutoTranslated,

        authors: article.authors,
        references: article.references,
        imageUrl: article.imageUrl,
        createdAt: article.createdAt,
        category: article.category,
        likes: article.likes,

        authorId: article.authorId,
      },
    });
  } catch (error) {
    console.error("❌ getMyArticleSingle error:", error);
    res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const updateArticle = async (req, res) => {
  try {
    const article = await Article.findById(req.params.id);

    if (!article) {
      return res.status(404).json({ message: "Not found" });
    }

    const {
      title,
      content,
      abstract,
      tags,
      metaDescription,
      metaKeywords,
      authors,
      references,
      imageUrl,
      category,
      readTime,
      isPublished,
    } = req.body;

    // 🔥 1. Проверяем изменения
    const titleChanged = title !== undefined && title !== article.title;
    const contentChanged = content !== undefined && content !== article.content;
    const abstractChanged =
      abstract !== undefined && abstract !== article.abstract;

    const mustInvalidate = titleChanged || contentChanged || abstractChanged;

    // 🔹 2. Обновляем поля
    if (title !== undefined) article.title = title;
    if (content !== undefined) article.content = content;
    if (abstract !== undefined) article.abstract = abstract;
    if (tags !== undefined) article.tags = tags;
    if (metaDescription !== undefined)
      article.metaDescription = metaDescription;
    if (metaKeywords !== undefined) article.metaKeywords = metaKeywords;
    if (authors !== undefined) article.authors = authors;
    if (references !== undefined) article.references = references;
    if (imageUrl !== undefined) article.imageUrl = imageUrl;
    if (category !== undefined) article.category = category;
    if (readTime !== undefined) article.readTime = readTime;
    if (isPublished !== undefined) article.isPublished = isPublished;

    // 🔥 3. Если контент изменился → увеличиваем версию
    if (mustInvalidate) {
      article.translationVersion += 1;
    }

    await article.save();

    // 🔥 4. Помечаем переводы как устаревшие
    if (mustInvalidate) {
      await markTranslationsAsStale({
        entityId: article._id,
        entityType: "Article",
      });
    }

    res.json({
      success: true,
      article,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};

export const getArticlesList = async (req, res) => {
  try {
    const articles = await Article.find({ isPublished: true })
      .sort({ createdAt: -1 })
      .limit(20);

    // 🔥 ВОТ СЮДА СТАВИТСЯ Promise.all
    const result = await Promise.all(
      articles.map(async (article) => {
        const localized = await getTranslationIfExists({
          entity: article,
          entityType: "Article",
          targetLanguage: req.language,
        });

        return {
          _id: article._id,

          title: localized.title,
          abstract: localized.abstract,

          imageUrl: article.imageUrl,
          createdAt: article.createdAt,

          originalLanguage: article.originalLanguage,
          displayedLanguage: localized.displayedLanguage,

          isOriginal: localized.isOriginal,
        };
      }),
    );

    res.json({
      success: true,
      articles: result,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
