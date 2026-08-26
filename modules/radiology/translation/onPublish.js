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
//
// ДВА ВХОДА В ОДНУ РАБОТУ. scheduleCaseTranslation зовут три сервиса смены
// статуса — им результат не нужен. Агент-доводчик (ai/caseAgent.js) публикует
// через те же сервисы, но обязан сказать в отчёте, перевёлся кейс или нет, и
// потому ждёт — startCaseTranslation. Оба входа ведут в ОДНО обещание: без
// этого агент и сервис публикации запускали бы перевод одного кейса дважды
// одновременно, оба видели бы «перевода ещё нет» и оба платили бы за вызов
// модели. Карта процессная — та же оговорка, что в translatedCase.js: при
// нескольких инстансах PM2 дубликат возможен, но запись идемпотентна
// (upsert по caseType+caseId+lang), и цена дубликата — лишний вызов модели,
// а не испорченные данные.

import logger from "../../../common/logger.js";

const inFlight = new Map();

/**
 * Запустить перевод кейса и получить обещание результата. Повторный вызов,
 * пока перевод идёт, присоединяется к идущему, а не запускает второй.
 *
 * @returns {Promise<object>} отчёт translateCase: { created, updated, skipped, failed }
 */
export function startCaseTranslation(caseType, caseId, { actorId = null } = {}) {
  const key = `${caseType}:${caseId}`;
  const running = inFlight.get(key);
  if (running) return running;

  const promise = (async () => {
    const { translateCase } = await import("./translateCase.service.js");
    return translateCase(caseType, caseId, { actorId });
  })().finally(() => inFlight.delete(key));

  inFlight.set(key, promise);
  return promise;
}

/**
 * То же самое, но для тех, кому результат не нужен: ошибка гасится в лог.
 * Обещание создаётся синхронно (а не через setImmediate), чтобы попасть в
 * карту раньше, чем к той же работе придёт второй желающий.
 */
export function scheduleCaseTranslation(caseType, caseId, { actorId = null } = {}) {
  startCaseTranslation(caseType, caseId, { actorId }).catch((err) => {
    logger?.error?.(
      { err, caseType, caseId: String(caseId) },
      "case translation after publish failed",
    );
  });
}
