import Article from "../../common/models/Articles/articles.js";
import ArticleScine from "../../common/models/Articles/articles-scince.js";
import { findTranslation } from "./translation.repository.js";
import { enqueueTranslation } from "./translation.service.js";

const LANGUAGES = ["en", "ru", "az", "tr", "ar"];

const processEntityList = async (entities, entityType) => {
  for (const entity of entities) {
    for (const lang of LANGUAGES) {
      if (lang === entity.originalLanguage) continue;

      const exists = await findTranslation({
        entityId: entity._id,
        entityType,
        language: lang,
        version: entity.translationVersion,
      });

      if (!exists) {
        await enqueueTranslation({
          entity,
          entityType,
          targetLanguage: lang,
        });
      }
    }
  }
};

// 🔥 ВОТ ЭТА ФУНКЦИЯ СЮДА
export const prefetchTranslations = async () => {
  const articles = await Article.find({ isPublished: true })
    .sort({ views: -1 })
    .limit(10);

  const scineArticles = await ArticleScine.find({ isPublished: true })
    .sort({ views: -1 })
    .limit(10);

  await processEntityList(articles, "Article");
  await processEntityList(scineArticles, "ArticleScine");

  console.log("✅ Prefetch translations done");
};
