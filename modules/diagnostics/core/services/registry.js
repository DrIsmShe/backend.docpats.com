// server/modules/diagnostics/core/services/registry.js
//
// РЕЕСТР ПОДМОДУЛЕЙ-МОДАЛЬНОСТЕЙ. Тот же приём, что в radiology/reading-systems:
// одна модальность — один плагин. Добавить УЗИ-с-моделью = добавить плагин, а
// не переписать модуль.
//
// Плагин описывает ТРИ вещи:
//   1. что он принимает (виды артефактов),
//   2. по какому протоколу смотрит (чек-лист — то, что не должно быть забыто),
//   3. чем разбирает (анализатор) и на что он способен (текст / изображение).
//
// Почему чек-лист живёт здесь, а не в промпте: это медицинское содержание,
// его правит врач-редактор, и оно должно быть видно в коде целиком, а не
// растворяться в строке запроса к модели.

import { CAPABILITIES, MODALITY_KEYS } from "../../constants.js";

const registry = new Map();

/**
 * @typedef {object} ModalityPlugin
 * @property {string} key            ключ из MODALITY_KEYS
 * @property {string} title          как называется врачу
 * @property {string} group          группировка в интерфейсе
 * @property {string} purpose        одна фраза: что этот подмодуль делает
 * @property {string[]} accepts      виды артефактов (ARTIFACT_KINDS)
 * @property {string[]} capabilities что умеет: "text" и/или "image"
 * @property {string[]} checklist    протокол осмотра/разбора
 * @property {string[]} redFlags     что нельзя пропустить
 * @property {string} analyzer       ключ анализатора
 * @property {string} [binaryNote]   честное объяснение, что происходит с
 *   принятым, но НЕ разбираемым машиной материалом: снимком, PDF, видео,
 *   аудио. Обязателен, если такой материал принимается. Молчаливое «принял
 *   файл и сделал вид, что посмотрел» — худшее, что можно сделать в
 *   медицинском интерфейсе, поэтому это проверяется тестом.
 */

export function registerModality(plugin) {
  if (!MODALITY_KEYS.includes(plugin.key)) {
    throw new Error(`Неизвестная модальность: ${plugin.key}`);
  }
  const unknownCaps = (plugin.capabilities ?? []).filter(
    (c) => !CAPABILITIES.includes(c),
  );
  if (unknownCaps.length) {
    throw new Error(`Неизвестные возможности у ${plugin.key}: ${unknownCaps}`);
  }
  if (!plugin.analyzer) {
    throw new Error(`У модальности ${plugin.key} не указан анализатор`);
  }
  registry.set(plugin.key, Object.freeze(plugin));
  return plugin;
}

export function getModality(key) {
  return registry.get(key) ?? null;
}

export function hasModality(key) {
  return registry.has(key);
}

/** Все модальности в порядке MODALITY_KEYS — интерфейсу нужен стабильный порядок. */
export function listModalities() {
  return MODALITY_KEYS.map((k) => registry.get(k)).filter(Boolean);
}

/**
 * Описание для клиента. Чек-лист и красные флаги отдаём тоже: врач должен
 * видеть, по какому протоколу его материал будут разбирать, до того как
 * отправит. Скрытый протокол — это доверие вслепую.
 */
export function describeModalities() {
  return listModalities().map((m) => ({
    key: m.key,
    title: m.title,
    group: m.group,
    purpose: m.purpose,
    accepts: m.accepts,
    capabilities: m.capabilities,
    checklist: m.checklist,
    redFlags: m.redFlags,
    binaryNote: m.binaryNote ?? null,
  }));
}

/** Умеет ли модальность читать само изображение (а не только текст о нём). */
export function supportsImages(key) {
  return Boolean(registry.get(key)?.capabilities?.includes("image"));
}

/** Только для тестов: изолировать реестр между наборами. */
export function _resetRegistry() {
  registry.clear();
}
