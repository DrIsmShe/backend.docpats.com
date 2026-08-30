// modules/clinic/clinic-medical/pdf/dosingUnits.js
//
// Единицы дозирования и кратность приёма для бланка.
//
// Строку вида «1 таблетка · 4 раза в день · 7 дней» бланк складывает сам,
// из кодов, сохранённых в рецепте. Раньше её склеивал клиент при создании
// и сохранял текстом: врач заполнял форму по-русски, а пациент печатал
// бланк по-азербайджански и видел русские слова в графе приёма. Перевести
// текст задним числом нельзя — из «54 дня» не вытащить число и единицу
// надёжно.
//
// Файл СГЕНЕРИРОВАН из локалей клиента (public/locales/*/clinic.json):
// врач видит в форме ровно то, что попадёт на бумагу. Правки вносите в
// локали, а не сюда.

export const DOSING = {
  ru: {
    strength: {
      mg: "мг",
      g: "г",
      mcg: "мкг",
      ml: "мл",
      iu: "МЕ",
      percent: "%",
      mg_ml: "мг/мл",
    },
    dose: {
      tablet: ["таблетка", "таблетки", "таблеток"],
      capsule: ["капсула", "капсулы", "капсул"],
      piece: ["штука", "штуки", "штук"],
      ml: ["мл", "мл", "мл"],
      spoon: ["ложка", "ложки", "ложек"],
      drop: ["капля", "капли", "капель"],
      spray: ["впрыск", "впрыска", "впрысков"],
      inhalation: ["вдох", "вдоха", "вдохов"],
      dose: ["доза", "дозы", "доз"],
      ampoule: ["ампула", "ампулы", "ампул"],
      application: ["нанесение", "нанесения", "нанесений"],
      suppository: ["свеча", "свечи", "свечей"],
      sachet: ["пакетик", "пакетика", "пакетиков"],
      g: ["г", "г", "г"],
    },
    duration: {
      day: ["день", "дня", "дней"],
      week: ["неделя", "недели", "недель"],
      month: ["месяц", "месяца", "месяцев"],
    },
    freq: {
      qd: "1 раз в день",
      bid: "2 раза в день",
      tid: "3 раза в день",
      qid: "4 раза в день",
      q4h: "каждые 4 часа",
      q6h: "каждые 6 часов",
      q8h: "каждые 8 часов",
      q12h: "каждые 12 часов",
      qod: "через день",
      qw: "1 раз в неделю",
      prn: "по потребности",
      once: "однократно",
    },
  },
  en: {
    strength: {
      mg: "mg",
      g: "g",
      mcg: "mcg",
      ml: "ml",
      iu: "IU",
      percent: "%",
      mg_ml: "mg/ml",
    },
    dose: {
      tablet: ["tablet", "tablets", "tablets"],
      capsule: ["capsule", "capsules", "capsules"],
      piece: ["piece", "pieces", "pieces"],
      ml: ["ml", "ml", "ml"],
      spoon: ["spoonful", "spoonfuls", "spoonfuls"],
      drop: ["drop", "drops", "drops"],
      spray: ["spray", "sprays", "sprays"],
      inhalation: ["inhalation", "inhalations", "inhalations"],
      dose: ["dose", "doses", "doses"],
      ampoule: ["ampoule", "ampoules", "ampoules"],
      application: ["application", "applications", "applications"],
      suppository: ["suppository", "suppositories", "suppositories"],
      sachet: ["sachet", "sachets", "sachets"],
      g: ["g", "g", "g"],
    },
    duration: {
      day: ["day", "days", "days"],
      week: ["week", "weeks", "weeks"],
      month: ["month", "months", "months"],
    },
    freq: {
      qd: "once a day",
      bid: "twice a day",
      tid: "three times a day",
      qid: "four times a day",
      q4h: "every 4 hours",
      q6h: "every 6 hours",
      q8h: "every 8 hours",
      q12h: "every 12 hours",
      qod: "every other day",
      qw: "once a week",
      prn: "as needed",
      once: "once only",
    },
  },
  az: {
    strength: {
      mg: "mq",
      g: "q",
      mcg: "mkq",
      ml: "ml",
      iu: "BV",
      percent: "%",
      mg_ml: "mq/ml",
    },
    dose: {
      tablet: ["tablet", "tablet", "tablet"],
      capsule: ["kapsul", "kapsul", "kapsul"],
      piece: ["ədəd", "ədəd", "ədəd"],
      ml: ["ml", "ml", "ml"],
      spoon: ["qaşıq", "qaşıq", "qaşıq"],
      drop: ["damcı", "damcı", "damcı"],
      spray: ["püskürtmə", "püskürtmə", "püskürtmə"],
      inhalation: ["nəfəs", "nəfəs", "nəfəs"],
      dose: ["doza", "doza", "doza"],
      ampoule: ["ampula", "ampula", "ampula"],
      application: ["sürtmə", "sürtmə", "sürtmə"],
      suppository: ["şam", "şam", "şam"],
      sachet: ["paket", "paket", "paket"],
      g: ["q", "q", "q"],
    },
    duration: {
      day: ["gün", "gün", "gün"],
      week: ["həftə", "həftə", "həftə"],
      month: ["ay", "ay", "ay"],
    },
    freq: {
      qd: "gündə 1 dəfə",
      bid: "gündə 2 dəfə",
      tid: "gündə 3 dəfə",
      qid: "gündə 4 dəfə",
      q4h: "hər 4 saatdan bir",
      q6h: "hər 6 saatdan bir",
      q8h: "hər 8 saatdan bir",
      q12h: "hər 12 saatdan bir",
      qod: "gündən bir",
      qw: "həftədə 1 dəfə",
      prn: "ehtiyac olduqda",
      once: "birdəfəlik",
    },
  },
  tr: {
    strength: {
      mg: "mg",
      g: "g",
      mcg: "mcg",
      ml: "ml",
      iu: "IU",
      percent: "%",
      mg_ml: "mg/ml",
    },
    dose: {
      tablet: ["tablet", "tablet", "tablet"],
      capsule: ["kapsül", "kapsül", "kapsül"],
      piece: ["adet", "adet", "adet"],
      ml: ["ml", "ml", "ml"],
      spoon: ["ölçek", "ölçek", "ölçek"],
      drop: ["damla", "damla", "damla"],
      spray: ["püskürtme", "püskürtme", "püskürtme"],
      inhalation: ["inhalasyon", "inhalasyon", "inhalasyon"],
      dose: ["doz", "doz", "doz"],
      ampoule: ["ampul", "ampul", "ampul"],
      application: ["uygulama", "uygulama", "uygulama"],
      suppository: ["fitil", "fitil", "fitil"],
      sachet: ["poşet", "poşet", "poşet"],
      g: ["g", "g", "g"],
    },
    duration: {
      day: ["gün", "gün", "gün"],
      week: ["hafta", "hafta", "hafta"],
      month: ["ay", "ay", "ay"],
    },
    freq: {
      qd: "günde 1 kez",
      bid: "günde 2 kez",
      tid: "günde 3 kez",
      qid: "günde 4 kez",
      q4h: "her 4 saatte bir",
      q6h: "her 6 saatte bir",
      q8h: "her 8 saatte bir",
      q12h: "her 12 saatte bir",
      qod: "gün aşırı",
      qw: "haftada 1 kez",
      prn: "gerektiğinde",
      once: "tek doz",
    },
  },
  ar: {
    strength: {
      mg: "ملغ",
      g: "غ",
      mcg: "ميكروغ",
      ml: "مل",
      iu: "وحدة دولية",
      percent: "%",
      mg_ml: "ملغ/مل",
    },
    dose: {
      tablet: ["قرص", "أقراص", "أقراص"],
      capsule: ["كبسولة", "كبسولات", "كبسولات"],
      piece: ["قطعة", "قطع", "قطع"],
      ml: ["مل", "مل", "مل"],
      spoon: ["ملعقة", "ملاعق", "ملاعق"],
      drop: ["قطرة", "قطرات", "قطرات"],
      spray: ["بخة", "بخات", "بخات"],
      inhalation: ["استنشاق", "استنشاقات", "استنشاقات"],
      dose: ["جرعة", "جرعات", "جرعات"],
      ampoule: ["أمبولة", "أمبولات", "أمبولات"],
      application: ["دهنة", "دهنات", "دهنات"],
      suppository: ["تحميلة", "تحاميل", "تحاميل"],
      sachet: ["كيس", "أكياس", "أكياس"],
      g: ["غ", "غ", "غ"],
    },
    duration: {
      day: ["يوم", "أيام", "أيام"],
      week: ["أسبوع", "أسابيع", "أسابيع"],
      month: ["شهر", "أشهر", "أشهر"],
    },
    freq: {
      qd: "مرة واحدة يومياً",
      bid: "مرتين يومياً",
      tid: "ثلاث مرات يومياً",
      qid: "أربع مرات يومياً",
      q4h: "كل 4 ساعات",
      q6h: "كل 6 ساعات",
      q8h: "كل 8 ساعات",
      q12h: "كل 12 ساعة",
      qod: "يوماً بعد يوم",
      qw: "مرة واحدة أسبوعياً",
      prn: "عند الحاجة",
      once: "مرة واحدة فقط",
    },
  },
};

// Форма числа по правилам языка. Русский различает 1 / 2-4 / 5+; прочие
// языки — только единственное и множественное, поэтому вторая и третья
// формы у них совпадают.
function pluralIndex(n, lang) {
  if (lang !== "ru") return n === 1 ? 0 : 1;
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 0;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 1;
  return 2;
}

/**
 * Строка вида «7 дней» из числа и кода единицы. Пусто, если кода нет:
 * значит рецепт старый или врач вписал условие своими словами — тогда
 * бланк берёт готовый текст из самого рецепта, как и раньше.
 */
export function amountText(amount, unit, group, lang) {
  if (amount == null || !unit) return "";
  const dict = (DOSING[lang] || DOSING.ru)[group];
  const entry = dict && dict[unit];
  if (!entry) return "";
  return `${amount} ${entry[pluralIndex(Number(amount), lang)]}`;
}

/** Кратность приёма по коду. */
export function freqText(code, lang) {
  if (!code) return "";
  const dict = DOSING[lang] || DOSING.ru;
  return (dict.freq && dict.freq[code]) || "";
}

export default DOSING;
