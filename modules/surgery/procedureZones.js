// modules/surgery/procedureZones.js
//
// Сколько кадра разрешено отдавать модели на перерисовку — по типу операции.
//
// Порог здесь не про качество картинки, а про смысл слова «симуляция».
// Внутри маски модель рисует ЗАНОВО, и чем она больше, тем меньше остаётся
// от пациента: сборка по маске держит неприкосновенным только то, что вне
// её границ.
//
// Числа выведены из практики, а не из головы. На снимке лица крупным
// планом (452×679) полоска под нижними веками занимает 2-3% кадра, нос
// целиком — 4-6%, лоб с бровями — около 8%. Тридцать процентов, стоявшие
// здесь сначала, — это нижняя треть лица: врач получал чужой подбородок и
// швы по краю выделения, формально не превысив лимит.

/** Точечные вмешательства: зона измеряется единицами процентов кадра. */
const FACE_TIGHT = new Set([
  "rhinoplasty",
  "blepharoplasty",
  "brow_lift",
  "otoplasty",
  "chin_implant",
  "cheek_implant",
  "lip_augmentation",
  "lip_lift",
  "fat_grafting_face",
  "septoplasty",
]);

/** Обширные лицевые: правка законно захватывает половину лица или шею. */
const FACE_WIDE = new Set(["facelift", "neck_lift", "ear_reconstruction"]);

export const FACE_PROCEDURES = new Set([...FACE_TIGHT, ...FACE_WIDE]);

export const isFaceProcedure = (procedure) => FACE_PROCEDURES.has(procedure);

/** Верхняя граница закрашенного, % кадра. */
export function maxPaintedPct(procedure) {
  if (FACE_TIGHT.has(procedure)) return 12;
  if (FACE_WIDE.has(procedure)) return 25;
  return 70;
}

/**
 * Нижняя граница: меньше — маска считается ненарисованной.
 *
 * Полтысячных процента кадра — это след кисти, а не зона операции: на
 * снимке 452×679 порог отсекает всё тоньше примерно 1500 пикселей. Штрих
 * по брови, который врач принял за разметку, давал 0.35% и проходил.
 */
export const MIN_PAINTED_PCT = 0.5;

export default {
  FACE_PROCEDURES,
  isFaceProcedure,
  maxPaintedPct,
  MIN_PAINTED_PCT,
};
