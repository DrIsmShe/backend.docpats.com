// modules/surgery/procedureZones.js
//
// Сколько кадра разрешено отдавать модели на перерисовку — по типу операции.
//
// Порог здесь не про качество картинки, а про смысл слова «симуляция».
// Блефаропластика меняет полоску под глазами: если закрашено полкадра,
// врач просит не симуляцию операции, а новое лицо, и получит именно его.
// Лицевые вмешательства режем жёстко; на теле правка законно бывает
// крупной (абдоминопластика — весь живот), там порог мягче.

export const FACE_PROCEDURES = new Set([
  "rhinoplasty",
  "blepharoplasty",
  "facelift",
  "brow_lift",
  "otoplasty",
  "chin_implant",
  "cheek_implant",
  "lip_augmentation",
  "lip_lift",
  "neck_lift",
  "fat_grafting_face",
  "ear_reconstruction",
  "septoplasty",
]);

export const isFaceProcedure = (procedure) => FACE_PROCEDURES.has(procedure);

/** Верхняя граница закрашенного, % кадра. */
export function maxPaintedPct(procedure) {
  return isFaceProcedure(procedure) ? 30 : 70;
}

/** Нижняя граница: меньше — маска считается ненарисованной. */
export const MIN_PAINTED_PCT = 0.3;

export default { FACE_PROCEDURES, isFaceProcedure, maxPaintedPct, MIN_PAINTED_PCT };
