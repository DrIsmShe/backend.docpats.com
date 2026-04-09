import mongoose from "mongoose";
import ArticleSingle from "../../../common/models/Articles/articles-scince.js";
import User from "../../../common/models/Auth/users.js";
import { getOrCreateTranslation } from "../../../modules/translation/translation.service.js";

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

export const myArticleScientificSingleController = async (req, res) => {
  const { id: articleId } = req.params;

  if (!mongoose.Types.ObjectId.isValid(articleId)) {
    return res
      .status(400)
      .json({ success: false, message: "Неверный формат ID статьи" });
  }

  try {
    const articleDoc = await ArticleSingle.findById(articleId)
      .populate({
        path: "authorId",
        model: User,
        select:
          "username role avatar firstNameEncrypted lastNameEncrypted firstName lastName",
      })
      .exec();

    if (!articleDoc) {
      return res
        .status(404)
        .json({ success: false, message: "Статья не найдена" });
    }

    const targetLanguage =
      req.language ||
      req.headers["accept-language"]?.split(",")[0]?.split("-")[0] ||
      "en";

    console.log(
      "🌍 myArticleScientificSingle — requested language:",
      targetLanguage,
    );

    let localized = null;
    try {
      localized = await getOrCreateTranslation({
        entity: articleDoc,
        entityType: "ArticleScine",
        targetLanguage,
      });
    } catch (translationError) {
      console.error("⚠️ Translation error:", translationError.message);
    }

    const title = localized?.title ?? articleDoc.title;
    const content = localized?.content ?? articleDoc.content;
    const abstract = localized?.abstract ?? articleDoc.abstract ?? "";
    const displayedLanguage =
      localized?.displayedLanguage ?? articleDoc.originalLanguage ?? "en";
    const isOriginal = localized?.isOriginal ?? true;
    const isAutoTranslated = localized?.isAutoTranslated ?? false;

    console.log("📦 localized:", displayedLanguage, isOriginal);

    return res.status(200).json({
      success: true,
      data: {
        _id: articleDoc._id,

        title,
        content,
        abstract,

        originalContent: articleDoc.content,
        originalAbstract: articleDoc.abstract ?? "",
        originalLanguage: articleDoc.originalLanguage,

        displayedLanguage,
        isOriginal,
        isAutoTranslated,
        translatedFrom: localized?.translatedFrom ?? null,

        authors: articleDoc.authors,
        references: articleDoc.references,
        imageUrl: articleDoc.imageUrl,
        createdAt: articleDoc.createdAt,
        category: articleDoc.category,
        likes: articleDoc.likes,
        tags: articleDoc.tags,
        isPublished: articleDoc.isPublished,

        authorId: articleDoc.authorId,
        authorPublic: buildAuthorPublic(articleDoc.authorId),
      },
    });
  } catch (error) {
    console.error("🔥 Ошибка при получении статьи:", error);
    return res.status(500).json({ success: false, message: error.message });
  }
};
