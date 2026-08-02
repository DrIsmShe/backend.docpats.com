// server/modules/dictation/providers/audio.store.js
//
// Доступ к аудиофайлу в хранилище. Отдельный модуль, а не функция внутри
// сервиса, по двум причинам:
//
//   1. Это внешняя зависимость (сеть + R2), и её нужно уметь подменять.
//      Внутримодульный вызов в ESM подменить нельзя: sinon/vi.spyOn на
//      экспорте не влияет на то, как модуль зовёт сам себя. Тест на это и
//      наткнулся — вместо заглушки пошёл настоящий сетевой запрос.
//   2. Когда аудио переедет с публичного URL на подписанные ссылки или на
//      прямое чтение из бакета, менять придётся один этот файл.

import { ValidationError } from "../../../common/utils/errors.js";

/** Сколько ждём хранилище. Аудио — мегабайты, но не десятки. */
const TIMEOUT_MS = Number(process.env.DICTATION_FETCH_TIMEOUT_MS ?? 30000);

/**
 * Скачивает аудио задания.
 * @param {string} url
 * @returns {Promise<Buffer>}
 */
export async function fetchAudio(url) {
  if (!url) throw new ValidationError("У задания нет аудио");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`Не удалось получить аудио (HTTP ${res.status})`);
    }
    return Buffer.from(await res.arrayBuffer());
  } finally {
    clearTimeout(timer);
  }
}
