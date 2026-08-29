// Четырнадцать корзин, по которым размечаются конференции.
//
// Это ровно те категории, по которым уже разложены 102 специальности в
// common/models/DoctorProfile/specialityOfDoctor.js (поле category). Держим
// коды, а не человеческие названия: в справочнике «Women’s Health» написано
// через типографский апостроф U+2019, и сравнение строк из двух репозиториев
// по такому ключу однажды молча потеряет половину выборки.
//
// Список продублирован в новостном движке
// (modules/conferences/conference.service.js) намеренно: это два отдельных
// репозитория с отдельным деплоем, общей зависимости между ними нет.
// Менять — в обоих местах.

export const CONFERENCE_CATEGORIES = [
  "therapeutic",
  "surgical",
  "diagnostics",
  "rehabilitation",
  "dentistry",
  "womens-health",
  "pediatrics",
  "mental-health",
  "ophthalmology-ent",
  "sports-medicine",
  "oncology",
  "emergency",
  "mens-health",
  "pharmacy",
];

// Specialization.category → код. Ключи нормализованы: апостроф любого вида
// убран, регистр приведён к нижнему.
const BY_CATEGORY_NAME = {
  "therapeutic specialties": "therapeutic",
  "surgical specialties": "surgical",
  diagnostics: "diagnostics",
  rehabilitation: "rehabilitation",
  dentistry: "dentistry",
  "womens health": "womens-health",
  pediatrics: "pediatrics",
  "mental health": "mental-health",
  "ophthalmology and ent": "ophthalmology-ent",
  "sports medicine": "sports-medicine",
  oncology: "oncology",
  "emergency care": "emergency",
  "mens health": "mens-health",
  pharmacy: "pharmacy",
};

/** «Women’s Health» → "womens-health". Возвращает null для незнакомого. */
export function categoryNameToCode(name) {
  const key = String(name || "")
    .toLowerCase()
    .replace(/['’ʼ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return BY_CATEGORY_NAME[key] || null;
}

/** Отбрасывает всё, чего нет в списке. Пустой результат = «интересно всё». */
export function normalizeConferenceCategories(input) {
  if (!Array.isArray(input)) return [];
  const out = [];
  for (const raw of input) {
    const code = String(raw || "").trim().toLowerCase();
    if (CONFERENCE_CATEGORIES.includes(code) && !out.includes(code)) out.push(code);
  }
  return out;
}
