// server/common/utils/pagination.js
//
// Постраничная выдача списков: страница + сколько всего подходит под фильтр.
//
// ЗАЧЕМ ОБЩИЙ МОДУЛЬ. Один и тот же дефект уже дважды находился в проде: список
// отдавал первые N записей, не сообщая, что он обрезан, а интерфейс подписывал
// этот кусок как «всего N». Врач искал запись, не находил и решал, что её нет.
//
// Молчаливое усечение опаснее пустой страницы: пустую видно сразу, усечённую
// невозможно отличить от полной. Поэтому здесь три вещи вместе, и порознь они
// не работают:
//   total   — сколько ВСЕГО подходит под фильтр, независимо от страницы;
//   skip/limit — какую часть отдаём;
//   hasMore — есть ли ещё, чтобы интерфейс не вычислял это сам.
//
// Домменные фильтры (по названию, по статусу) остаются в модулях: они разные.
// Общая здесь только механика страниц.

/**
 * Экранирование пользовательской строки для regexp.
 *
 * Без него ввод вида «C++ (3)» — валидный запрос — превращается в сломанный
 * или очень дорогой шаблон. Экранируем ВСЕ метасимволы: перечислять «опасные»
 * по одному — способ однажды забыть один.
 */
export function escapeRegex(input) {
  return String(input ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Размеры страницы. Клиент может попросить меньше, больше — нет. */
export const DEFAULT_PAGE_SIZE = 24;
export const MAX_PAGE_SIZE = 100;

/**
 * Условие поиска по текстовому полю: подстрока, регистронезависимо.
 *
 * @param {string} field — имя поля модели
 * @param {string} q
 * @returns {object|null} условие или null, если искать нечего
 */
export function substringFilter(field, q) {
  const needle = String(q ?? "").trim();
  if (!needle) return null;
  return { [field]: { $regex: escapeRegex(needle), $options: "i" } };
}

/**
 * Страница списка + сколько всего подходит под фильтр.
 *
 * count и find идут параллельно: это два независимых запроса к одной
 * коллекции, и ждать их по очереди значит удваивать задержку на ровном месте.
 *
 * @param {import("mongoose").Model} Model
 * @param {object} a
 * @param {object} a.query
 * @param {object} [a.sort]
 * @param {string} [a.select]
 * @param {number} [a.skip]
 * @param {number} [a.limit]
 * @returns {Promise<{items: object[], total: number, skip: number, limit: number, hasMore: boolean}>}
 */
export async function paginate(
  Model,
  { query, sort = { createdAt: -1 }, select, skip = 0, limit = DEFAULT_PAGE_SIZE },
) {
  const safeLimit = Math.min(Math.max(1, Number(limit) || DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
  const safeSkip = Math.max(0, Number(skip) || 0);

  const finder = Model.find(query).sort(sort).skip(safeSkip).limit(safeLimit);
  if (select) finder.select(select);

  const [items, total] = await Promise.all([finder.lean(), Model.countDocuments(query)]);

  return {
    items,
    total,
    skip: safeSkip,
    limit: safeLimit,
    hasMore: safeSkip + items.length < total,
  };
}
