// server/modules/radiology/lexicon/lexicon.js
//
// Контролируемый словарь находок. Учащийся выбирает ярлык находки ОТСЮДА,
// а не пишет свободным текстом, — иначе классификацию нельзя оценить
// детерминированно («инфильтрат» vs «инфильтрация» vs «затемнение»
// были бы разными строками при одном смысле).
//
// Каждый термин привязан к модальностям, где он осмыслен: палитра
// находок в ридере собирается пересечением словаря и модальности кейса.
//
// Диагнозы (impression) НЕ здесь: их набор задаёт автор кейса своим
// списком принятых ключей — диагнозов слишком много, чтобы фиксировать
// глобальным справочником, а находок — обозримое ядро.

/** @type {Array<{key:string, label:string, modalities:string[]}>} */
export const FINDINGS_LEXICON = [
  // Норма — отдельный «ярлык», чтобы «здесь ничего нет» было явным
  // ответом, а не отсутствием ответа.
  { key: "normal", label: "Норма / без патологии", modalities: MODALITIES_ALL() },

  // Лёгкие / грудная клетка (CXR, CT).
  { key: "consolidation", label: "Консолидация / инфильтрат", modalities: ["cxr", "ct"] },
  { key: "nodule", label: "Очаг / узелок (<3 см)", modalities: ["cxr", "ct"] },
  { key: "mass", label: "Образование (≥3 см)", modalities: ["cxr", "ct", "mri", "us"] },
  { key: "pleural_effusion", label: "Плевральный выпот", modalities: ["cxr", "ct", "us"] },
  { key: "pneumothorax", label: "Пневмоторакс", modalities: ["cxr", "ct"] },
  { key: "atelectasis", label: "Ателектаз", modalities: ["cxr", "ct"] },
  { key: "cardiomegaly", label: "Кардиомегалия", modalities: ["cxr", "ct"] },
  { key: "hilar_lymphadenopathy", label: "Лимфаденопатия корней", modalities: ["cxr", "ct"] },
  { key: "pneumoperitoneum", label: "Свободный газ под диафрагмой", modalities: ["cxr", "ct"] },
  { key: "rib_fracture", label: "Перелом ребра", modalities: ["cxr", "ct"] },
  { key: "pulmonary_edema", label: "Отёк лёгких", modalities: ["cxr", "ct"] },
  { key: "cavity", label: "Полость / деструкция", modalities: ["cxr", "ct"] },

  // Общие «структурные» находки для КТ/МРТ/УЗИ (заглушки под будущие плагины).
  { key: "cyst", label: "Киста", modalities: ["ct", "mri", "us"] },
  { key: "free_fluid", label: "Свободная жидкость", modalities: ["ct", "us"] },
  { key: "calcification", label: "Кальцинат", modalities: ["ct", "mri", "us", "mammography"] },
  { key: "hemorrhage", label: "Кровоизлияние", modalities: ["ct", "mri"] },
  { key: "edema", label: "Отёк / масс-эффект", modalities: ["ct", "mri"] },
  { key: "infarct", label: "Инфаркт / зона ишемии", modalities: ["ct", "mri"] },
  { key: "ms_lesion", label: "Очаг демиелинизации", modalities: ["mri"] },
  { key: "lymphadenopathy", label: "Лимфаденопатия", modalities: ["ct", "mri", "us"] },
  { key: "gallstone", label: "Конкремент (камень)", modalities: ["us", "ct"] },
  { key: "hydronephrosis", label: "Гидронефроз", modalities: ["us", "ct"] },

  // ЭКГ.
  { key: "st_elevation", label: "Элевация сегмента ST", modalities: ["ecg"] },
  { key: "st_depression", label: "Депрессия сегмента ST", modalities: ["ecg"] },
  { key: "t_inversion", label: "Инверсия зубца T", modalities: ["ecg"] },
  { key: "peaked_t", label: "Высокий заострённый T", modalities: ["ecg"] },
  { key: "pathological_q", label: "Патологический зубец Q", modalities: ["ecg"] },
  { key: "af", label: "Фибрилляция предсердий", modalities: ["ecg"] },
  { key: "aflutter", label: "Трепетание предсердий", modalities: ["ecg"] },
  { key: "av_block", label: "АВ-блокада", modalities: ["ecg"] },
  { key: "lbbb", label: "Блокада левой ножки пучка Гиса", modalities: ["ecg"] },
  { key: "rbbb", label: "Блокада правой ножки пучка Гиса", modalities: ["ecg"] },
  { key: "vt", label: "Желудочковая тахикардия", modalities: ["ecg"] },
  { key: "pvc", label: "Желудочковая экстрасистола", modalities: ["ecg"] },
  { key: "lvh", label: "Гипертрофия левого желудочка", modalities: ["ecg"] },
  { key: "long_qt", label: "Удлинение интервала QT", modalities: ["ecg"] },
  { key: "sinus_tachy", label: "Синусовая тахикардия", modalities: ["ecg"] },
  { key: "sinus_brady", label: "Синусовая брадикардия", modalities: ["ecg"] },
];

// Отдельная функция вместо литерала, чтобы «все модальности» не пришлось
// дублировать и держать в синхроне вручную. Импорт снизу — модуль ESM
// поднимает объявления функций до использования (hoisting), поэтому
// вызов в литерале выше корректен.
function MODALITIES_ALL() {
  return ["cxr", "ct", "mri", "us", "ecg", "mammography", "other"];
}

const BY_KEY = new Map(FINDINGS_LEXICON.map((t) => [t.key, t]));

/** Термин по ключу или undefined. */
export function findingTerm(key) {
  return BY_KEY.get(key);
}

/** Валиден ли ключ находки в принципе. */
export function isKnownFinding(key) {
  return BY_KEY.has(key);
}

/** Термины, применимые к модальности — палитра находок ридера. */
export function findingsForModality(modality) {
  return FINDINGS_LEXICON.filter((t) => t.modalities.includes(modality));
}
