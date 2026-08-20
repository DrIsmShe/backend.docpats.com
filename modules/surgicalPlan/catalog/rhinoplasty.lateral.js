// server/modules/surgicalPlan/catalog/rhinoplasty.lateral.js

/* ============================================================
   RHINOPLASTY — LATERAL VIEW: КАТАЛОГ ОПЕРАЦИЙ
   ============================================================
   Замкнутый список того, что план вообще может содержать.
   Модель не придумывает операции — она раскладывает свободный
   текст врача по этому каталогу. Чего здесь нет, то попадает
   в outOfScope плана, а не в тихую отсебятину.

   Каталог привязан к ПРОЕКЦИИ, а не к процедуре: в боковой
   проекции не измерить ширину крыльев, поэтому операций над
   ней здесь нет. Для фронтальной проекции будет свой каталог.

   Границы параметров — не клинические рекомендации, а рамки
   правдоподобия: за ними запрос почти наверняка означает
   опечатку или недопонимание, и это стоит переспросить.
   Окончательное решение всегда за врачом.

   ── EFFECTS: почему три вида, а не коэффициенты ──

   Соблазн — прописать «резекция горбинки 1 мм даёт +2° к
   назофронтальному углу» и считать таблицу дельт целиком.
   Это была бы выдумка: коэффициент зависит от исходной
   анатомии, толщины кожи и техники. Поэтому эффект бывает:

   - identity    — измерение меняется на значение параметра
                   ПО ОПРЕДЕЛЕНИЮ. Ротация кончика на +5° и
                   есть +5° к назолабиальному углу. Считаем.
   - derived     — измерение вычисляется из других (Goode =
                   проекция / длина). Пересчитываем точно.
   - qualitative — известно только направление. Показываем
                   стрелку и НЕ показываем число.

   Так таблица «до/после» остаётся честной: там, где стоит
   цифра, она выводится геометрически, а не угадана.
   ============================================================ */

export const PROCEDURE_CODE = "rhinoplasty_lateral";

// Пресет антропометрии, на измерениях которого работает план.
export const PRESET_CODE = "rhinoplasty_lateral";

export const META = {
  code: PROCEDURE_CODE,
  presetCode: PRESET_CODE,
  viewType: "lateral_left",
  label: {
    ru: "Ринопластика — боковая проекция",
    en: "Rhinoplasty — lateral view",
  },
  // Версия входит в сохранённый план: разбор старым каталогом
  // должен быть отличим от разбора новым.
  version: "1.0.0",
};

/* ============================================================
   ОПЕРАЦИИ
   ============================================================ */

export const OPERATIONS = [
  {
    code: "dorsal_hump_reduction",
    label: { ru: "Резекция горбинки", en: "Dorsal hump reduction" },
    description:
      "Снижение костно-хрящевого горба спинки носа. Просьбы вида «убрать горбинку», «выровнять спинку».",
    params: {
      amount_mm: {
        type: "number",
        unit: "mm",
        min: 0.5,
        max: 6,
        step: 0.5,
        required: true,
        label: { ru: "Величина резекции", en: "Reduction amount" },
      },
    },
    effects: [
      { measurement: "nasofrontal_angle", kind: "qualitative", direction: "increase" },
    ],
    conflictsWith: ["dorsal_augmentation"],
  },

  {
    code: "dorsal_augmentation",
    label: { ru: "Аугментация спинки", en: "Dorsal augmentation" },
    description:
      "Наращивание спинки трансплантатом или филлером. Просьбы вида «поднять спинку», «убрать седловидность».",
    params: {
      amount_mm: {
        type: "number",
        unit: "mm",
        min: 0.5,
        max: 5,
        step: 0.5,
        required: true,
        label: { ru: "Величина аугментации", en: "Augmentation amount" },
      },
    },
    effects: [
      { measurement: "nasofrontal_angle", kind: "qualitative", direction: "decrease" },
    ],
    conflictsWith: ["dorsal_hump_reduction"],
  },

  {
    code: "radix_augmentation",
    label: { ru: "Аугментация радикса", en: "Radix augmentation" },
    description:
      "Наращивание корня носа в области назиона. Часто идёт вместе с резекцией горбинки, чтобы не получить «вдавленный» профиль.",
    params: {
      amount_mm: {
        type: "number",
        unit: "mm",
        min: 0.5,
        max: 4,
        step: 0.5,
        required: true,
        label: { ru: "Величина аугментации", en: "Augmentation amount" },
      },
    },
    effects: [
      { measurement: "nasofrontal_angle", kind: "qualitative", direction: "decrease" },
    ],
    conflictsWith: [],
  },

  {
    code: "tip_rotation",
    label: { ru: "Ротация кончика", en: "Tip rotation" },
    description:
      "Поворот кончика вверх (положительное значение) или вниз. Просьбы вида «приподнять кончик», «опустить кончик».",
    params: {
      delta_deg: {
        type: "number",
        unit: "degrees",
        min: -10,
        max: 20,
        step: 1,
        required: true,
        label: { ru: "Изменение угла", en: "Angle change" },
      },
    },
    // Назолабиальный угол определён через subnasale как вершину:
    // ротация кончика меняет его ровно на ту же величину.
    effects: [
      { measurement: "nasolabial_angle", kind: "identity", param: "delta_deg", sign: 1 },
    ],
    conflictsWith: [],
  },

  {
    code: "tip_projection_change",
    label: { ru: "Изменение проекции кончика", en: "Tip projection change" },
    description:
      "Выдвижение кончика вперёд (положительное) или его депроекция. Просьбы вида «кончик слишком торчит», «добавить проекции».",
    params: {
      delta_mm: {
        type: "number",
        unit: "mm",
        min: -6,
        max: 6,
        step: 0.5,
        required: true,
        label: { ru: "Изменение проекции", en: "Projection change" },
      },
    },
    effects: [
      { measurement: "tip_projection", kind: "identity", param: "delta_mm", sign: 1 },
    ],
    conflictsWith: [],
  },

  {
    code: "nasal_length_change",
    label: { ru: "Изменение длины носа", en: "Nasal length change" },
    description:
      "Укорочение (отрицательное значение) или удлинение носа по оси назион–кончик.",
    params: {
      delta_mm: {
        type: "number",
        unit: "mm",
        min: -6,
        max: 6,
        step: 0.5,
        required: true,
        label: { ru: "Изменение длины", en: "Length change" },
      },
    },
    effects: [
      { measurement: "nasal_length", kind: "identity", param: "delta_mm", sign: 1 },
    ],
    conflictsWith: [],
  },

  {
    code: "columellar_show_correction",
    label: { ru: "Коррекция показа колумеллы", en: "Columellar show correction" },
    description:
      "Изменение видимости колумеллы в профиль: «висящая колумелла» — отрицательное значение, «втянутая» — положительное.",
    params: {
      delta_mm: {
        type: "number",
        unit: "mm",
        min: -4,
        max: 4,
        step: 0.5,
        required: true,
        label: { ru: "Изменение показа", en: "Show change" },
      },
    },
    effects: [
      { measurement: "nasolabial_angle", kind: "qualitative", direction: "increase" },
    ],
    conflictsWith: [],
  },

  {
    code: "supratip_break_definition",
    label: { ru: "Формирование супратипного излома", en: "Supratip break definition" },
    description:
      "Проработка перехода спинка–кончик. Чисто эстетический штрих, измерениями боковой проекции не описывается.",
    params: {
      intensity: {
        type: "enum",
        options: ["subtle", "moderate", "pronounced"],
        required: true,
        label: { ru: "Выраженность", en: "Intensity" },
      },
    },
    effects: [],
    conflictsWith: [],
  },
];

/* ============================================================
   ПРОИЗВОДНЫЕ ИЗМЕРЕНИЯ
   ============================================================
   Считаются из предсказанных значений других измерений.
   Порядок применения: сначала identity, потом derived.
   ============================================================ */

export const DERIVED = [
  {
    measurement: "goode_ratio",
    from: ["tip_projection", "nasal_length"],
    // Goode = проекция кончика / длина носа — то же определение,
    // что в пресете антропометрии.
    compute: ({ tip_projection, nasal_length }) =>
      nasal_length ? tip_projection / nasal_length : null,
  },
];

/* ============================================================
   ХЕЛПЕРЫ
   ============================================================ */

export const OPERATION_CODES = OPERATIONS.map((o) => o.code);

export const OPERATION_MAP = OPERATIONS.reduce((acc, o) => {
  acc[o.code] = o;
  return acc;
}, {});

export default {
  meta: META,
  operations: OPERATIONS,
  derived: DERIVED,
  helpers: { OPERATION_CODES, OPERATION_MAP },
};
