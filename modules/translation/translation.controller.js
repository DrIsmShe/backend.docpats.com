import Article from "../../common/models/Articles/articles.js";
import ArticleScine from "../../common/models/Articles/articles-scince.js";
import {
  findTranslation,
  saveReviewedTranslation,
} from "../../modules/translation/translation.repository.js";

const getEntityModel = (entityType) => {
  if (entityType === "Article") return Article;
  if (entityType === "ArticleScine") return ArticleScine;
  throw new Error("Unsupported entity type");
};

export const getTranslationForEdit = async (req, res) => {
  try {
    const { entityId, entityType, language } = req.params;

    const Model = getEntityModel(entityType);
    const entity = await Model.findById(entityId);

    if (!entity) {
      return res.status(404).json({
        success: false,
        message: "Source entity not found",
      });
    }

    const translation = await findTranslation({
      entityId,
      entityType,
      language,
      version: entity.translationVersion,
    });

    return res.status(200).json({
      success: true,
      source: {
        title: entity.title,
        abstract: entity.abstract || "",
        content: entity.content,
        originalLanguage: entity.originalLanguage,
        translationVersion: entity.translationVersion,
      },
      translation: translation
        ? {
            title: translation.title,
            abstract: translation.abstract || "",
            content: translation.content,
            language: translation.language,
            isReviewed: translation.isReviewed,
            translationMethod: translation.translationMethod,
            sourceVersion: translation.sourceVersion,
          }
        : null,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};

export const saveTranslationReview = async (req, res) => {
  try {
    const { entityId, entityType, language } = req.params;
    const { title, abstract, content } = req.body;

    const Model = getEntityModel(entityType);
    const entity = await Model.findById(entityId);

    if (!entity) {
      return res.status(404).json({
        success: false,
        message: "Source entity not found",
      });
    }

    const saved = await saveReviewedTranslation({
      entityId,
      entityType,
      language,
      title,
      abstract,
      content,
      translatedFrom: entity.originalLanguage,
      sourceVersion: entity.translationVersion,
      reviewedBy: req.userId || null,
      translationMethod: "author_reviewed",
    });

    return res.status(200).json({
      success: true,
      message: "Translation saved successfully",
      translation: saved,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message,
    });
  }
};
