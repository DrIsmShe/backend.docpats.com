// server/modules/radiology/translation/onPublish.js
//
// Запуск перевода кейса после публикации.
//
// Без await и без try/catch у вызывающего: публикация от перевода не зависит.
// Кейс уже виден русскоязычным врачам, и недоступность модели — не повод его
// не публиковать. Соответственно и ошибка здесь гасится внутри: пробросить её
// наверх значило бы отменить публикацию из-за перевода.
//
// Очереди здесь нет намеренно, в отличие от банка вопросов. Кейсы публикуют
// поштучно и редко — это ручная редакторская работа, а не пакетный импорт
// сотен вопросов. Заводить ради неё вторую очередь с воркером означало бы
// добавить Redis в путь, который прекрасно живёт без него.

import logger from "../../../common/logger.js";

export function scheduleCaseTranslation(caseType, caseId, { actorId = null } = {}) {
  setImmediate(async () => {
    try {
      const { translateCase } = await import("./translateCase.service.js");
      await translateCase(caseType, caseId, { actorId });
    } catch (err) {
      logger?.error?.(
        { err, caseType, caseId: String(caseId) },
        "case translation after publish failed",
      );
    }
  });
}
