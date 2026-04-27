// server/modules/anthropometry/utils/calibrationMath.js

import { distance, denormalizePoint } from "./geometry.js";

/* ============================================================
   CALIBRATION MATH
   ============================================================
   Чистые функции для вычисления pixelsPerMm.
   Без зависимостей от БД и сервисов. */

/* ============================================================
   RULER CALIBRATION
   ============================================================
   Дано:
   - две точки в нормализованных координатах
   - размеры фото
   - известное расстояние между точками в мм
   Возвращает: pixelsPerMm */

export const computePixelsPerMmFromRuler = ({
  point1,
  point2,
  widthPx,
  heightPx,
  knownDistanceMm,
}) => {
  if (typeof knownDistanceMm !== "number" || knownDistanceMm <= 0) {
    throw new Error("knownDistanceMm must be a positive number");
  }

  // Переводим точки в пиксели
  const p1Px = denormalizePoint(point1, { widthPx, heightPx });
  const p2Px = denormalizePoint(point2, { widthPx, heightPx });

  const distancePx = distance(p1Px, p2Px);

  if (distancePx < 1) {
    throw new Error(
      "Calibration points are too close (distance < 1px). " +
        "Place them further apart for accurate calibration.",
    );
  }

  return distancePx / knownDistanceMm;
};

/* ============================================================
   INTERPUPILLARY CALIBRATION
   ============================================================
   Дано:
   - координаты левого и правого зрачков
   - размеры фото
   - предполагаемое межзрачковое расстояние (по полу)
   Возвращает: pixelsPerMm

   Стандартные значения IPD (Interpupillary Distance):
   - male:    63 мм (диапазон 54-74)
   - female:  61 мм (диапазон 51-69)
   - other:   62 мм (среднее)
   - unknown: 63 мм (наиболее частое)

   Источник: PD measurements from US Army anthropometry survey */

export const DEFAULT_IPD_BY_GENDER = {
  male: 63,
  female: 61,
  other: 62,
  unknown: 63,
};

export const computePixelsPerMmFromInterpupillary = ({
  leftPupil,
  rightPupil,
  widthPx,
  heightPx,
  assumedDistanceMm,
}) => {
  if (typeof assumedDistanceMm !== "number" || assumedDistanceMm <= 0) {
    throw new Error("assumedDistanceMm must be a positive number");
  }

  const leftPx = denormalizePoint(leftPupil, { widthPx, heightPx });
  const rightPx = denormalizePoint(rightPupil, { widthPx, heightPx });

  const distancePx = distance(leftPx, rightPx);

  if (distancePx < 10) {
    throw new Error(
      "Pupils are too close (distance < 10px). " +
        "Check that you placed both pupils correctly.",
    );
  }

  return distancePx / assumedDistanceMm;
};

/* ============================================================
   SANITY CHECKS
   ============================================================
   pixelsPerMm должен быть в разумном диапазоне.
   Слишком малый — фото слишком мелкое или ошибка точек.
   Слишком большой — фото гигантское или точки на 1 пиксель. */

const MIN_REASONABLE_PPM = 0.5;
const MAX_REASONABLE_PPM = 100;

export const isReasonablePixelsPerMm = (ppm) => {
  return (
    typeof ppm === "number" &&
    Number.isFinite(ppm) &&
    ppm >= MIN_REASONABLE_PPM &&
    ppm <= MAX_REASONABLE_PPM
  );
};

export const assertReasonablePixelsPerMm = (ppm) => {
  if (!isReasonablePixelsPerMm(ppm)) {
    throw new Error(
      `Computed pixelsPerMm (${ppm}) is outside reasonable range ` +
        `[${MIN_REASONABLE_PPM}, ${MAX_REASONABLE_PPM}]. ` +
        "Check calibration points and known distance.",
    );
  }
};
