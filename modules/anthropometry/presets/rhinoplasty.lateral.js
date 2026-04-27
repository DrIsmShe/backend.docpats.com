// server/modules/anthropometry/presets/rhinoplasty.lateral.js

/* ============================================================
   RHINOPLASTY — LATERAL VIEW PRESET
   ============================================================
   Каталог анатомических точек и клинических измерений
   для боковой проекции ринопластики.

   Источники норм:
   - Daniel R.K. "Aesthetic Plastic Surgery: Rhinoplasty"
   - Toriumi D.M. "Structure Rhinoplasty"
   - Powell N., Humphreys B. "Proportions of the Aesthetic Face"

   ВАЖНО: нормы — европеоидные, для взрослых.
   Этнические/возрастные корректировки — Фаза 2.
   ============================================================ */

export const PRESET_CODE = "rhinoplasty_lateral";

export const PRESET_META = {
  code: PRESET_CODE,
  procedureType: "rhinoplasty",
  viewType: "lateral_left", // также применим к lateral_right (зеркально)
  label: {
    ru: "Ринопластика — боковая проекция",
    en: "Rhinoplasty — Lateral View",
  },
  version: "1.0.0",
};

/* ============================================================
   LANDMARKS
   ============================================================
   Каждая точка имеет:
   - id      : системный код, неизменяемый, snake_case
   - label   : человеческое название (мульти-язык)
   - hint    : подсказка для врача — где её ставить
   - order   : порядок отображения в UI (по сверху-вниз)
   - default : примерные нормализованные координаты для авто-раскладки
              в центре фото. Врач корректирует.
   ============================================================ */

export const LANDMARKS = [
  {
    id: "glabella",
    label: { ru: "Глабелла", en: "Glabella" },
    hint: "Самая выступающая точка лба между бровями",
    order: 1,
    default: { x: 0.5, y: 0.18 },
  },
  {
    id: "nasion",
    label: { ru: "Назион", en: "Nasion" },
    hint: "Самая глубокая точка носолобного угла",
    order: 2,
    default: { x: 0.5, y: 0.28 },
  },
  {
    id: "rhinion",
    label: { ru: "Ринион", en: "Rhinion" },
    hint: "Переход костной части в хрящевую (область горбинки)",
    order: 3,
    default: { x: 0.5, y: 0.4 },
  },
  {
    id: "supratip",
    label: { ru: "Супратип", en: "Supratip" },
    hint: "Точка над кончиком носа (supratip break)",
    order: 4,
    default: { x: 0.5, y: 0.55 },
  },
  {
    id: "tip",
    label: { ru: "Кончик носа", en: "Nasal Tip" },
    hint: "Самая выступающая точка кончика",
    order: 5,
    default: { x: 0.5, y: 0.62 },
  },
  {
    id: "subnasale",
    label: { ru: "Субназале", en: "Subnasale" },
    hint: "Точка соединения колумеллы и верхней губы",
    order: 6,
    default: { x: 0.5, y: 0.72 },
  },
  {
    id: "alar_crease",
    label: { ru: "Складка крыла", en: "Alar Crease" },
    hint: "Точка прикрепления крыла носа к щеке",
    order: 7,
    default: { x: 0.45, y: 0.68 },
  },
  {
    id: "labrale_superius",
    label: { ru: "Лабрале супериус", en: "Labrale Superius" },
    hint: "Верхняя точка красной каймы верхней губы",
    order: 8,
    default: { x: 0.5, y: 0.78 },
  },
];

/* ============================================================
   MEASUREMENTS
   ============================================================
   Типы:
   - "angle"    : угол в градусах между тремя точками (vertex в середине)
   - "distance" : расстояние между двумя точками в мм (требует калибровку)
   - "ratio"    : отношение двух расстояний (безразмерное)

   Поле norm:
   - { min, max } — диапазон нормы
   - genderSpecific: true — норма зависит от пола (см. normByGender)
   ============================================================ */

export const MEASUREMENTS = [
  {
    code: "nasofrontal_angle",
    label: { ru: "Назофронтальный угол", en: "Nasofrontal Angle" },
    type: "angle",
    points: ["glabella", "nasion", "rhinion"], // vertex = nasion (средняя)
    unit: "degrees",
    norm: { min: 115, max: 135 },
    description:
      "Угол между лбом и спинкой носа. Влияет на восприятие выступания носа.",
  },

  {
    code: "nasolabial_angle",
    label: { ru: "Назолабиальный угол", en: "Nasolabial Angle" },
    type: "angle",
    points: ["tip", "subnasale", "labrale_superius"], // vertex = subnasale
    unit: "degrees",
    genderSpecific: true,
    normByGender: {
      male: { min: 90, max: 105 },
      female: { min: 95, max: 110 },
      other: { min: 90, max: 110 },
      unknown: { min: 90, max: 110 },
    },
    description:
      "Угол между колумеллой и верхней губой. Влияет на 'опущенность' кончика.",
  },

  {
    code: "nasal_length",
    label: { ru: "Длина носа (N–Tip)", en: "Nasal Length (N–Tip)" },
    type: "distance",
    points: ["nasion", "tip"],
    unit: "mm",
    norm: { min: 44, max: 53 },
    description:
      "Расстояние от назиона до кончика. Базовая ось пропорций носа.",
  },

  {
    code: "tip_projection",
    label: { ru: "Проекция кончика", en: "Tip Projection" },
    type: "distance",
    points: ["alar_crease", "tip"],
    unit: "mm",
    norm: { min: 26, max: 33 },
    description:
      "Выступание кончика от линии щеки. Ключевой параметр ринопластики.",
  },

  {
    code: "goode_ratio",
    label: { ru: "Соотношение Goode", en: "Goode Ratio" },
    type: "ratio",
    numerator: ["alar_crease", "tip"], // проекция кончика
    denominator: ["nasion", "tip"], // длина носа
    unit: "ratio",
    norm: { min: 0.55, max: 0.6 },
    description: "Отношение проекции к длине носа. Эстетический эталон Goode.",
  },
];

/* ============================================================
   HELPERS
   ============================================================
   Используются в measurement.service.js и валидаторах. */

// Список ID точек preset-а (для проверки полноты разметки)
export const LANDMARK_IDS = LANDMARKS.map((l) => l.id);

// Карта id → landmark (для быстрого доступа)
export const LANDMARK_MAP = LANDMARKS.reduce((acc, l) => {
  acc[l.id] = l;
  return acc;
}, {});

// Карта code → measurement
export const MEASUREMENT_MAP = MEASUREMENTS.reduce((acc, m) => {
  acc[m.code] = m;
  return acc;
}, {});

// Получить норму с учётом пола пациента
export const getNorm = (measurementCode, patientGender = "unknown") => {
  const m = MEASUREMENT_MAP[measurementCode];
  if (!m) return null;
  if (m.genderSpecific && m.normByGender) {
    return m.normByGender[patientGender] || m.normByGender.unknown;
  }
  return m.norm;
};

// Интерпретация значения относительно нормы
export const interpretValue = (value, norm) => {
  if (!norm || value == null) return "unknown";
  if (value < norm.min) return "below_norm";
  if (value > norm.max) return "above_norm";
  return "within_norm";
};

/* ============================================================
   DEFAULT EXPORT — preset как единый объект
   ============================================================ */

export default {
  meta: PRESET_META,
  landmarks: LANDMARKS,
  measurements: MEASUREMENTS,
  helpers: {
    LANDMARK_IDS,
    LANDMARK_MAP,
    MEASUREMENT_MAP,
    getNorm,
    interpretValue,
  },
};
