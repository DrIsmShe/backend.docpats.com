// server/modules/radiology/ai/dailyTopics.js
//
// Программа тем для ночной автогенерации кейсов (jobs/radiologyDailyCases).
//
// ПОЧЕМУ СПИСОК, А НЕ «ПУСТЬ ИИ ПРИДУМАЕТ САМ». Модель, которую каждую ночь
// просят «придумай учебный кейс по КТ», сходится к трём-четырём самым
// хрестоматийным сюжетам: получается не программа обучения, а десять
// вариантов одного инсульта. Список задаёт покрытие: пока в нём есть
// неразобранные темы, каждая ночь приносит НОВЫЙ сюжет, а не новый пересказ.
//
// Темы подобраны под контролируемый словарь находок (lexicon.js): каждая
// опирается на находки, которые в этой модальности вообще можно разметить.
// Тема, для которой в словаре нет ни одного кода, дала бы кейс с пустым
// планом находок — учащемуся нечего было бы отмечать на снимке.
//
// difficulty здесь — не украшение: она уходит в промпт и влияет на то,
// насколько очевидной модель сделает картину. Смесь лёгких и сложных нужна,
// чтобы каталог не состоял из одних «хрестоматийных» либо одних «зубодробительных».
//
// Ключ темы (key) — опора дедупликации: он записывается в кейс
// (autoGen.topicKey), и по нему генератор понимает, что тема уже разобрана.
// Ключи менять нельзя — переименование сделает старую тему «неразобранной».

/** @typedef {{key: string, topic: string, difficulty: "easy"|"medium"|"hard"}} DailyTopic */

/** @type {Record<string, DailyTopic[]>} */
export const DAILY_TOPICS = {
  // ─── Рентгенография органов грудной клетки ───
  cxr: [
    { key: "cxr_pneumothorax", topic: "спонтанный пневмоторакс у молодого мужчины высокого роста", difficulty: "easy" },
    { key: "cxr_lobar_pneumonia", topic: "долевая пневмония с чёткой границей консолидации", difficulty: "easy" },
    { key: "cxr_pleural_effusion", topic: "плевральный выпот с косой линией Дамуазо", difficulty: "easy" },
    { key: "cxr_pulmonary_edema", topic: "кардиогенный отёк лёгких на фоне декомпенсации сердечной недостаточности", difficulty: "medium" },
    { key: "cxr_cardiomegaly", topic: "кардиомегалия при дилатационной кардиомиопатии", difficulty: "medium" },
    { key: "cxr_pneumoperitoneum", topic: "свободный газ под диафрагмой при перфорации полого органа", difficulty: "medium" },
    { key: "cxr_lobar_atelectasis", topic: "ателектаз доли из-за обтурации бронха", difficulty: "hard" },
    { key: "cxr_solitary_nodule", topic: "одиночный округлый очаг в лёгком как случайная находка", difficulty: "medium" },
    { key: "cxr_tb_cavity", topic: "туберкулёзная каверна в верхней доле", difficulty: "hard" },
    { key: "cxr_rib_fractures", topic: "переломы рёбер после травмы грудной клетки", difficulty: "medium" },
    { key: "cxr_sarcoidosis", topic: "двусторонняя лимфаденопатия корней при саркоидозе", difficulty: "hard" },
    { key: "cxr_normal", topic: "нормальная рентгенограмма грудной клетки у пациента с жалобами на одышку (учить не гипердиагностировать)", difficulty: "easy" },
  ],

  // ─── Компьютерная томография ───
  ct: [
    { key: "ct_ich", topic: "внутримозговое кровоизлияние на фоне гипертонического криза", difficulty: "easy" },
    { key: "ct_ischemic_stroke", topic: "ишемический инсульт в бассейне средней мозговой артерии", difficulty: "medium" },
    { key: "ct_free_fluid_trauma", topic: "свободная жидкость в брюшной полости после тупой травмы живота", difficulty: "medium" },
    { key: "ct_ureteral_stone", topic: "конкремент мочеточника с гидронефрозом при почечной колике", difficulty: "easy" },
    { key: "ct_liver_mass", topic: "объёмное образование печени, выявленное при обследовании", difficulty: "hard" },
    { key: "ct_renal_cyst", topic: "простая киста почки как случайная находка", difficulty: "easy" },
    { key: "ct_mediastinal_nodes", topic: "медиастинальная лимфаденопатия при лимфопролиферативном заболевании", difficulty: "hard" },
    { key: "ct_lung_nodule", topic: "солидный очаг в лёгком при скрининге курильщика", difficulty: "medium" },
    { key: "ct_lung_cavity", topic: "полость деструкции в лёгком при абсцедирующей пневмонии", difficulty: "hard" },
    { key: "ct_traumatic_pneumothorax", topic: "травматический пневмоторакс с переломами рёбер", difficulty: "medium" },
    { key: "ct_mass_effect", topic: "перифокальный отёк и масс-эффект вокруг объёмного образования мозга", difficulty: "hard" },
    { key: "ct_coronary_calcification", topic: "кальцинаты как признак давнего процесса (случайная находка при КТ)", difficulty: "medium" },
  ],

  // ─── Магнитно-резонансная томография ───
  mri: [
    { key: "mri_ms", topic: "очаги демиелинизации при рассеянном склерозе", difficulty: "medium" },
    { key: "mri_acute_infarct", topic: "острый ишемический инфаркт мозга на диффузионно-взвешенных изображениях", difficulty: "medium" },
    { key: "mri_subacute_hemorrhage", topic: "подострое внутричерепное кровоизлияние", difficulty: "hard" },
    { key: "mri_brain_tumor", topic: "объёмное образование головного мозга с перифокальным отёком", difficulty: "hard" },
    { key: "mri_arachnoid_cyst", topic: "арахноидальная киста как случайная находка", difficulty: "easy" },
    { key: "mri_spine_lesion", topic: "очаговое поражение позвонка с отёком костного мозга", difficulty: "hard" },
    { key: "mri_soft_tissue_mass", topic: "образование мягких тканей конечности", difficulty: "medium" },
    { key: "mri_lymphadenopathy", topic: "регионарная лимфаденопатия при стадировании опухоли", difficulty: "medium" },
  ],

  // ─── Ультразвуковое исследование ───
  us: [
    { key: "us_cholelithiasis", topic: "конкременты желчного пузыря с акустической тенью", difficulty: "easy" },
    { key: "us_acute_cholecystitis", topic: "острый холецистит: утолщение стенки и перивезикальная жидкость", difficulty: "medium" },
    { key: "us_hydronephrosis", topic: "гидронефроз при обструкции мочеточника", difficulty: "easy" },
    { key: "us_fast_free_fluid", topic: "свободная жидкость по протоколу FAST при травме", difficulty: "medium" },
    { key: "us_renal_cyst", topic: "простая киста почки при плановом УЗИ", difficulty: "easy" },
    { key: "us_thyroid_nodule", topic: "узловое образование щитовидной железы с кальцинатами", difficulty: "hard" },
    { key: "us_pleural_effusion", topic: "плевральный выпот при УЗИ грудной клетки у постели больного", difficulty: "medium" },
    { key: "us_liver_mass", topic: "очаговое образование печени при скрининговом УЗИ", difficulty: "hard" },
  ],

  // ─── Электрокардиография ───
  ecg: [
    { key: "ecg_stemi", topic: "острый инфаркт миокарда с подъёмом сегмента ST нижней стенки", difficulty: "easy" },
    { key: "ecg_ischemia", topic: "депрессия сегмента ST при нагрузочной ишемии", difficulty: "medium" },
    { key: "ecg_t_inversion", topic: "инверсия зубца T в передних отведениях", difficulty: "medium" },
    { key: "ecg_hyperkalemia", topic: "гиперкалиемия с высокими заострёнными зубцами T", difficulty: "medium" },
    { key: "ecg_old_mi", topic: "патологические зубцы Q как след перенесённого инфаркта", difficulty: "medium" },
    { key: "ecg_af", topic: "фибрилляция предсердий с частым желудочковым ответом", difficulty: "easy" },
    { key: "ecg_aflutter", topic: "трепетание предсердий с проведением 2:1", difficulty: "hard" },
    { key: "ecg_av_block", topic: "АВ-блокада II степени типа Мобитц I", difficulty: "hard" },
    { key: "ecg_lbbb", topic: "блокада левой ножки пучка Гиса у пациента с болью в груди", difficulty: "hard" },
    { key: "ecg_rbbb", topic: "блокада правой ножки пучка Гиса как случайная находка", difficulty: "easy" },
    { key: "ecg_vt", topic: "мономорфная желудочковая тахикардия", difficulty: "hard" },
    { key: "ecg_lvh", topic: "гипертрофия левого желудочка при длительной артериальной гипертензии", difficulty: "medium" },
  ],

  // ─── Станция «Анализы» ───
  //
  // Дальше — станции БЕЗ СНИМКОВ. Они самодостаточны: изображение им не
  // нужно по устройству, поэтому ночной прогон доводит их до конца сам,
  // вплоть до публикации и перевода. Ключи тем живут в общем пространстве,
  // станция читается по префиксу (lab_ / vp_).
  labs: [
    { key: "lab_ida", topic: "железодефицитная анемия у молодой женщины с меноррагией", difficulty: "easy" },
    { key: "lab_b12", topic: "В12-дефицитная анемия с макроцитозом", difficulty: "medium" },
    { key: "lab_dka", topic: "диабетический кетоацидоз", difficulty: "medium" },
    { key: "lab_aki", topic: "острое повреждение почек преренального генеза", difficulty: "medium" },
    { key: "lab_hypothyroid", topic: "первичный гипотиреоз", difficulty: "easy" },
    { key: "lab_hyperthyroid", topic: "тиреотоксикоз при болезни Грейвса", difficulty: "medium" },
    { key: "lab_hepatitis", topic: "острый гепатит с цитолитическим синдромом", difficulty: "medium" },
    { key: "lab_cholestasis", topic: "холестатический синдром при обструкции желчных путей", difficulty: "hard" },
    { key: "lab_hyperkalemia", topic: "гиперкалиемия у пациента на иАПФ с почечной недостаточностью", difficulty: "hard" },
    { key: "lab_hyponatremia", topic: "гипонатриемия при синдроме неадекватной секреции АДГ", difficulty: "hard" },
    { key: "lab_bacterial_infection", topic: "бактериальная инфекция: лейкоцитоз со сдвигом влево и высокий СРБ", difficulty: "easy" },
    { key: "lab_myeloma", topic: "множественная миелома: гиперкальциемия, анемия, высокий белок", difficulty: "hard" },
    { key: "lab_rhabdomyolysis", topic: "рабдомиолиз после чрезмерной физической нагрузки", difficulty: "medium" },
    { key: "lab_normal_variants", topic: "отклонения от референса, которые клинически незначимы (учить не гипердиагностировать)", difficulty: "medium" },
  ],

  // ─── Станция «Виртуальный пациент» ───
  vp: [
    { key: "vp_chest_pain", topic: "боль в груди у мужчины 58 лет: отличить острый коронарный синдром от некардиальных причин", difficulty: "medium" },
    { key: "vp_dyspnea", topic: "остро возникшая одышка: ТЭЛА против декомпенсации сердечной недостаточности", difficulty: "hard" },
    { key: "vp_abdominal_pain", topic: "острая боль в правой подвздошной области у молодого пациента", difficulty: "easy" },
    { key: "vp_headache", topic: "внезапная сильнейшая головная боль: исключить субарахноидальное кровоизлияние", difficulty: "hard" },
    { key: "vp_fever_unknown", topic: "лихорадка неясного генеза у пациента после поездки", difficulty: "hard" },
    { key: "vp_syncope", topic: "обморок у пожилого пациента: кардиальные и некардиальные причины", difficulty: "medium" },
    { key: "vp_weight_loss", topic: "немотивированная потеря веса за три месяца", difficulty: "medium" },
    { key: "vp_fatigue", topic: "хроническая слабость: анемия, щитовидная железа или депрессия", difficulty: "easy" },
    { key: "vp_polyuria", topic: "полиурия и жажда у пациента среднего возраста", difficulty: "easy" },
    { key: "vp_jaundice", topic: "желтуха у взрослого: разграничить надпечёночную, печёночную и подпечёночную", difficulty: "hard" },
    { key: "vp_joint_pain", topic: "острый моноартрит: подагра, септический артрит или травма", difficulty: "medium" },
    { key: "vp_cough_chronic", topic: "хронический кашель более восьми недель у некурящего", difficulty: "medium" },
  ],
};

/** Темы, заданные для станции/модальности (пустой массив — её нет в программе). */
export function topicsFor(modality) {
  return DAILY_TOPICS[modality] ?? [];
}

/**
 * Следующая тема для модальности.
 *
 * Пока в программе есть неразобранные темы — берём первую по порядку: список
 * упорядочен от базовых сюжетов к сложным, и каталог наполняется в разумной
 * последовательности, а не случайными кусками.
 *
 * Когда программа пройдена целиком, тему НЕ прекращаем выдавать: круг идёт
 * заново со сдвигом (repeat = true). Вызывающий код обязан передать это в
 * подсказку модели — иначе второй круг дал бы дословно те же кейсы.
 *
 * @param {string} modality
 * @param {string[]} usedKeys ключи тем, уже разобранных в этой модальности
 * @param {number} seed      счётчик для сдвига на втором круге (обычно — число автокейсов)
 * @returns {(DailyTopic & {repeat: boolean})|null}
 */
export function pickTopic(modality, usedKeys = [], seed = 0) {
  const pool = topicsFor(modality);
  if (pool.length === 0) return null;

  const used = new Set(usedKeys.filter(Boolean));
  const fresh = pool.find((t) => !used.has(t.key));
  if (fresh) return { ...fresh, repeat: false };

  const index = ((Math.trunc(seed) % pool.length) + pool.length) % pool.length;
  return { ...pool[index], repeat: true };
}
