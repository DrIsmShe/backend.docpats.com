import ContentTranslation from "../../common/models/Articles/contentTranslation.js";

export const findTranslation = async ({
  entityId,
  entityType,
  language,
  version,
}) => {
  return ContentTranslation.findOne({
    entityId,
    entityType,
    language,
    isStale: false,
    sourceVersion: version,
  });
};

export const upsertTranslation = async ({
  entityId,
  entityType,
  language,
  data,
  originalLanguage,
  version,
}) => {
  const existing = await ContentTranslation.findOne({
    entityId,
    entityType,
    language,
  });

  // Если уже есть вручную проверенный перевод и он актуален — не затираем
  if (
    existing &&
    existing.isReviewed &&
    existing.sourceVersion === version &&
    existing.isStale === false
  ) {
    return existing;
  }

  return ContentTranslation.findOneAndUpdate(
    {
      entityId,
      entityType,
      language,
    },
    {
      entityId,
      entityType,
      language,
      title: data.title,
      content: data.content,
      abstract: data.abstract || "",
      translatedFrom: originalLanguage,
      translationProvider: "openai",
      translationMethod: "ai_auto",
      isAutoTranslated: true,
      isReviewed: false,
      reviewedBy: null,
      reviewedAt: null,
      sourceVersion: version,
      isStale: false,
      lastTranslatedAt: new Date(),
    },
    {
      new: true,
      upsert: true,
    },
  );
};

export const markTranslationsAsStale = async ({ entityId, entityType }) => {
  return ContentTranslation.updateMany(
    { entityId, entityType },
    { $set: { isStale: true } },
  );
};

export const saveReviewedTranslation = async ({
  entityId,
  entityType,
  language,
  title,
  abstract,
  content,
  translatedFrom,
  sourceVersion,
  reviewedBy,
  translationMethod = "human",
}) => {
  return ContentTranslation.findOneAndUpdate(
    {
      entityId,
      entityType,
      language,
    },
    {
      entityId,
      entityType,
      language,
      title,
      abstract: abstract || "",
      content,
      translatedFrom,
      translationProvider: "manual",
      translationMethod,
      isAutoTranslated: false,
      isReviewed: true,
      reviewedBy,
      reviewedAt: new Date(),
      sourceVersion,
      isStale: false,
      lastTranslatedAt: new Date(),
    },
    {
      new: true,
      upsert: true,
    },
  );
};
