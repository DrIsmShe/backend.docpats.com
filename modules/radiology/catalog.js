// server/modules/radiology/catalog.js
//
// Постраничная выдача каталога — общая для всех станций тренажёра.
//
// ЗАЧЕМ. Раньше каждая станция отдавала список «сколько влезет»: снимки — 50 по
// умолчанию (до 200), анализы и виртуальный пациент — жёстко 200. Пока кейсов
// десятки, разницы не видно. На семистах кейсах врач получал первые 50, а
// интерфейс писал «Всего кейсов: 50» — то есть врал, не сообщая об этом.
//
// Молчаливое усечение опаснее пустой страницы: пустую видно сразу, а
// усечённую невозможно отличить от полной. Врач ищет кейс, не находит и
// решает, что его нет.
//
// Поэтому здесь три вещи вместе, и порознь они не работают:
//   1. total — сколько ВСЕГО подходит под фильтр, независимо от страницы;
//   2. skip/limit — какую часть отдаём;
//   3. hasMore — есть ли ещё, чтобы интерфейсу не приходилось это вычислять.
//
// Поиск по названию — на стороне базы, а не клиента: искать можно только в том,
// что доехало, а доезжает теперь одна страница.

/**
 * Экранирование пользовательской строки для regexp.
 *
 * Без него ввод вида «C++ (3)» — валидный запрос врача — превращается в
 * сломанный или очень дорогой шаблон. Экранируем ВСЕ метасимволы: перечислять
 * «опасные» по одному — способ однажды забыть один.
 */
export function escapeRegex(input) {
  return String(input ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Размеры страницы. Клиент может попросить меньше, больше — нет. */
export const DEFAULT_PAGE_SIZE = 24;
export const MAX_PAGE_SIZE = 100;

/**
 * Условие поиска по названию: подстрока, регистронезависимо.
 *
 * Подстрока, а не полнотекстовый индекс, сознательно: названия кейсов короткие
 * и часто содержат аббревиатуры и латиницу вперемешку с кириллицей
 * («КТ ОГК: GGO»), где стемминг полнотекстового поиска скорее мешает. Когда
 * кейсов станут десятки тысяч, здесь появится текстовый индекс — вызывающий
 * код от этого не изменится.
 */
export function titleFilter(q) {
  const needle = String(q ?? "").trim();
  if (!needle) return null;
  return { title: { $regex: escapeRegex(needle), $options: "i" } };
}

/**
 * Страница списка + сколько всего подходит под фильтр.
 *
 * count и find идут параллельно: это два независимых запроса к одной коллекции,
 * и ждать их по очереди значит удваивать задержку каталога на ровном месте.
 *
 * @param {import("mongoose").Model} Model
 * @param {object} a
 * @param {object} a.query    условие выборки
 * @param {object} [a.sort]
 * @param {string} [a.select] проекция — ОБЯЗАТЕЛЬНО исключает эталон ответа
 * @param {number} [a.skip]
 * @param {number} [a.limit]
 * @returns {Promise<{items: object[], total: number, skip: number, limit: number, hasMore: boolean}>}
 */
export async function paginate(Model, { query, sort = { createdAt: -1 }, select, skip = 0, limit = DEFAULT_PAGE_SIZE }) {
  const safeLimit = Math.min(Math.max(1, Number(limit) || DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
  const safeSkip = Math.max(0, Number(skip) || 0);

  const finder = Model.find(query).sort(sort).skip(safeSkip).limit(safeLimit);
  if (select) finder.select(select);

  const [items, total] = await Promise.all([
    finder.lean(),
    Model.countDocuments(query),
  ]);

  return {
    items,
    total,
    skip: safeSkip,
    limit: safeLimit,
    hasMore: safeSkip + items.length < total,
  };
}
