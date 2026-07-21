// server/modules/education/education-ingest/extractors/index.js
//
// Реестр экстракторов. Устроен так же, как реестр платёжных провайдеров
// (modules/payments/providers/index.js): активный выбирается через env,
// по умолчанию — самый безопасный вариант.
//
//   EDUCATION_EXTRACTOR = manual | claude   (по умолчанию manual)
//
// Почему manual по умолчанию: ИИ-импорт стоит денег и отправляет файл во
// внешний сервис. Такое поведение должно включаться осознанно, а не
// оказаться включённым «само» после деплоя.

import manualExtractor from "./manual.extractor.js";
import claudeExtractor from "./claude.extractor.js";

const EXTRACTORS = {
  manual: manualExtractor,
  claude: claudeExtractor,
};

export function getActiveExtractorName() {
  return process.env.EDUCATION_EXTRACTOR || "manual";
}

export function getExtractor(name) {
  const key = name || getActiveExtractorName();
  const extractor = EXTRACTORS[key];
  if (!extractor) {
    throw new Error(`Unknown education extractor: ${key}`);
  }
  return extractor;
}

export function getActiveExtractor() {
  return getExtractor(getActiveExtractorName());
}

/** Список экстракторов и их готовность — для админского экрана. */
export function listExtractors() {
  return Object.entries(EXTRACTORS).map(([name, extractor]) => ({
    name,
    configured: extractor.isConfigured(),
    active: name === getActiveExtractorName(),
  }));
}
