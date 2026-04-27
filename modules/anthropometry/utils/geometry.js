// server/modules/anthropometry/utils/geometry.js

/* ============================================================
   GEOMETRY UTILITIES
   ============================================================
   Чистая математика для антропометрических измерений.

   Координатная система:
   - Все функции принимают точки в формате { x: Number, y: Number }
   - Координаты могут быть нормализованными (0..1) или в пикселях.
     Это не важно для расстояний и углов — главное единообразие
     внутри одного вызова.
   - В пикселях: ось Y растёт ВНИЗ (стандарт image coordinates)

   Никаких зависимостей. Чистые функции без побочных эффектов.
   ============================================================ */

/* ============================================================
   CONSTANTS
   ============================================================ */

const EPSILON = 1e-10; // допуск для сравнения с нулём

/* ============================================================
   ANGLE CONVERSION
   ============================================================ */

export const toDegrees = (radians) => (radians * 180) / Math.PI;
export const toRadians = (degrees) => (degrees * Math.PI) / 180;

/* ============================================================
   POINT VALIDATION
   ============================================================ */

/**
 * Проверка, что точка валидна для вычислений.
 * Возвращает true/false.
 */
export const isValidPoint = (point) => {
  return (
    point != null &&
    typeof point === "object" &&
    typeof point.x === "number" &&
    typeof point.y === "number" &&
    Number.isFinite(point.x) &&
    Number.isFinite(point.y)
  );
};

/**
 * Бросает исключение если точка невалидна.
 * Используется в начале каждой публичной функции.
 */
const assertValidPoint = (point, name = "point") => {
  if (!isValidPoint(point)) {
    throw new Error(
      `Invalid ${name}: expected { x: Number, y: Number }, got ${JSON.stringify(point)}`,
    );
  }
};

/* ============================================================
   COORDINATE TRANSFORMATIONS
   ============================================================ */

/**
 * Перевод нормализованных координат (0..1) в пиксели.
 * Используется при работе с landmarks из БД.
 */
export const denormalizePoint = (normalizedPoint, dimensions) => {
  assertValidPoint(normalizedPoint, "normalizedPoint");
  if (!dimensions || !dimensions.widthPx || !dimensions.heightPx) {
    throw new Error("dimensions must have widthPx and heightPx");
  }
  return {
    x: normalizedPoint.x * dimensions.widthPx,
    y: normalizedPoint.y * dimensions.heightPx,
  };
};

/**
 * Обратная операция — пиксели в нормализованные.
 */
export const normalizePoint = (pixelPoint, dimensions) => {
  assertValidPoint(pixelPoint, "pixelPoint");
  if (!dimensions || !dimensions.widthPx || !dimensions.heightPx) {
    throw new Error("dimensions must have widthPx and heightPx");
  }
  return {
    x: pixelPoint.x / dimensions.widthPx,
    y: pixelPoint.y / dimensions.heightPx,
  };
};

/* ============================================================
   DISTANCE
   ============================================================ */

/**
 * Евклидово расстояние между двумя точками.
 *
 * Единица измерения возвращаемого значения совпадает с
 * единицей входных координат. Если точки в пикселях —
 * результат в пикселях. Если в нормализованных — в долях
 * от ширины/высоты (что обычно бесполезно — нужно
 * сначала denormalize).
 */
export const distance = (p1, p2) => {
  assertValidPoint(p1, "p1");
  assertValidPoint(p2, "p2");

  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return Math.sqrt(dx * dx + dy * dy);
};

/**
 * Квадрат расстояния — быстрее (без sqrt), используется
 * когда нужно только сравнить расстояния, а не получить число.
 */
export const distanceSquared = (p1, p2) => {
  assertValidPoint(p1, "p1");
  assertValidPoint(p2, "p2");

  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  return dx * dx + dy * dy;
};

/* ============================================================
   ANGLE
   ============================================================ */

/**
 * Ограничение значения в диапазон [min, max].
 * Защита от выхода косинуса за [-1, 1] из-за floating point ошибок.
 */
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

/**
 * Угол при вершине vertex между лучами vertex→p1 и vertex→p2.
 *
 * Возвращает угол в ГРАДУСАХ в диапазоне [0, 180].
 *
 * Пример (назофронтальный угол):
 *   angleAtVertex(glabella, nasion, rhinion)
 *   — вершина в nasion, лучи к glabella и rhinion
 *
 * Бросает исключение если любая точка совпадает с vertex
 * (нельзя построить вектор нулевой длины).
 */
export const angleAtVertex = (p1, vertex, p2) => {
  assertValidPoint(p1, "p1");
  assertValidPoint(vertex, "vertex");
  assertValidPoint(p2, "p2");

  // Векторы от vertex к p1 и p2
  const v1 = { x: p1.x - vertex.x, y: p1.y - vertex.y };
  const v2 = { x: p2.x - vertex.x, y: p2.y - vertex.y };

  const len1 = Math.sqrt(v1.x * v1.x + v1.y * v1.y);
  const len2 = Math.sqrt(v2.x * v2.x + v2.y * v2.y);

  if (len1 < EPSILON) {
    throw new Error("p1 coincides with vertex — cannot compute angle");
  }
  if (len2 < EPSILON) {
    throw new Error("p2 coincides with vertex — cannot compute angle");
  }

  // Скалярное произведение
  const dot = v1.x * v2.x + v1.y * v2.y;

  // Косинус угла. Clamp защищает от floating point ошибок
  // (например, dot/(len1*len2) = 1.0000000001 → NaN из acos)
  const cosTheta = clamp(dot / (len1 * len2), -1, 1);

  return toDegrees(Math.acos(cosTheta));
};

/* ============================================================
   RATIO
   ============================================================ */

/**
 * Отношение длины отрезка [n1, n2] к длине отрезка [d1, d2].
 * Безразмерное число.
 *
 * Пример (Goode ratio):
 *   ratio(alar_crease, tip, nasion, tip)
 *   = расстояние(alar_crease→tip) / расстояние(nasion→tip)
 *
 * Бросает исключение если знаменатель ноль.
 */
export const ratio = (n1, n2, d1, d2) => {
  assertValidPoint(n1, "n1");
  assertValidPoint(n2, "n2");
  assertValidPoint(d1, "d1");
  assertValidPoint(d2, "d2");

  const numerator = distance(n1, n2);
  const denominator = distance(d1, d2);

  if (denominator < EPSILON) {
    throw new Error("denominator distance is zero — cannot compute ratio");
  }

  return numerator / denominator;
};

/* ============================================================
   PIXELS ↔ MILLIMETERS
   ============================================================
   Конвертация на основе калибровки (pixelsPerMm).
   Используется ПОСЛЕ distance() для перевода в реальные мм. */

export const pixelsToMm = (pixelDistance, pixelsPerMm) => {
  if (typeof pixelsPerMm !== "number" || pixelsPerMm <= 0) {
    throw new Error("pixelsPerMm must be a positive number");
  }
  return pixelDistance / pixelsPerMm;
};

export const mmToPixels = (mmDistance, pixelsPerMm) => {
  if (typeof pixelsPerMm !== "number" || pixelsPerMm <= 0) {
    throw new Error("pixelsPerMm must be a positive number");
  }
  return mmDistance * pixelsPerMm;
};

/* ============================================================
   ROUNDING
   ============================================================
   Медицинская точность: углы — 1 знак после запятой,
   расстояния в мм — 1 знак, отношения — 3 знака. */

export const roundAngle = (degrees) => Math.round(degrees * 10) / 10;
export const roundDistance = (mm) => Math.round(mm * 10) / 10;
export const roundRatio = (value) => Math.round(value * 1000) / 1000;
