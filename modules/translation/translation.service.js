import { findTranslation } from "./translation.repository.js";
import { getCacheKey, getFromCache, setToCache } from "./translation.cache.js";
import { translationQueue } from "./translation.queue.js";

const MAX_QUEUE_SIZE = 100;

export const enqueueTranslation = async ({
  entity,
  entityType,
  targetLanguage,
}) => {
  console.log(
    "📤 enqueueTranslation called:",
    entityType,
    String(entity._id),
    "→",
    targetLanguage,
  );

  const counts = await translationQueue.getJobCounts();
  console.log("📊 Queue counts:", counts);

  if (counts.waiting > MAX_QUEUE_SIZE) {
    console.warn("⚠️ Queue overloaded, skipping translation");
    return;
  }

  await translationQueue.add(
    "translate",
    { entity, entityType, targetLanguage },
    {
      jobId: `${entityType}:${entity._id}:${targetLanguage}`,
      removeOnComplete: true,
      removeOnFail: false,
      attempts: 3,
      backoff: { type: "exponential", delay: 2000 },
    },
  );

  console.log(
    "✅ Job added to queue:",
    `${entityType}:${entity._id}:${targetLanguage}`,
  );
};

export const getOrCreateTranslation = async ({
  entity,
  entityType,
  targetLanguage,
}) => {
  console.log(
    "🔍 getOrCreateTranslation:",
    entityType,
    String(entity._id),
    "→",
    targetLanguage,
    "| original:",
    entity.originalLanguage,
  );

  // 1. язык совпадает
  if (entity.originalLanguage === targetLanguage) {
    console.log("↩️ Same language, returning original");
    return {
      title: entity.title,
      content: entity.content,
      abstract: entity.abstract || "",
      displayedLanguage: entity.originalLanguage,
      isOriginal: true,
      isAutoTranslated: false,
      translatedFrom: null,
    };
  }

  const cacheKey = getCacheKey({
    entityId: entity._id,
    entityType,
    language: targetLanguage,
    version: entity.translationVersion,
  });

  // 2. Redis cache (async!)
  const cached = await getFromCache(cacheKey);
  if (cached) {
    console.log("⚡ Cache hit:", cacheKey);
    return cached;
  }

  // 3. DB
  const existing = await findTranslation({
    entityId: entity._id,
    entityType,
    language: targetLanguage,
    version: entity.translationVersion,
  });

  if (existing) {
    console.log("💾 DB hit:", targetLanguage);
    const result = {
      title: existing.title,
      content: existing.content,
      abstract: existing.abstract || "",
      displayedLanguage: existing.language,
      isOriginal: false,
      isAutoTranslated: existing.isAutoTranslated,
      translatedFrom: existing.translatedFrom,
    };
    await setToCache(cacheKey, result);
    return result;
  }

  // 4. нет перевода → в очередь
  console.log("📭 No translation found, enqueueing...");
  await enqueueTranslation({ entity, entityType, targetLanguage });

  // 5. возвращаем оригинал пока переводится
  return {
    title: entity.title,
    content: entity.content,
    abstract: entity.abstract || "",
    displayedLanguage: entity.originalLanguage,
    isOriginal: true,
    isAutoTranslated: false,
    translatedFrom: null,
  };
};

export const getTranslationIfExists = async ({
  entity,
  entityType,
  targetLanguage,
}) => {
  if (entity.originalLanguage === targetLanguage) {
    return {
      title: entity.title,
      abstract: entity.abstract || "",
      displayedLanguage: entity.originalLanguage,
      isOriginal: true,
    };
  }

  const cacheKey = getCacheKey({
    entityId: entity._id,
    entityType,
    language: targetLanguage,
    version: entity.translationVersion,
  });

  const cached = await getFromCache(cacheKey);
  if (cached) return cached;

  const existing = await findTranslation({
    entityId: entity._id,
    entityType,
    language: targetLanguage,
    version: entity.translationVersion,
  });

  if (existing) {
    return {
      title: existing.title,
      abstract: existing.abstract || "",
      displayedLanguage: existing.language,
      isOriginal: false,
      isAutoTranslated: existing.isAutoTranslated,
    };
  }

  return {
    title: entity.title,
    abstract: entity.abstract || "",
    displayedLanguage: entity.originalLanguage,
    isOriginal: true,
  };
};
