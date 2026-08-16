// server/common/config/aiPlanLimits.js
// ─────────────────────────────────────────────────────────────────────
//   ЕДИНЫЙ ИСТОЧНИК ПРАВДЫ для всех тарифных лимитов в DocPats.
//
//   Используется во всех AI-сервисах: user-synthesis, consultation-ai,
//   SOAP-генератор и т.д. Если меняешь лимит — меняй ТОЛЬКО здесь.
//
//   Обновлено: 2026-08-15 — тарифная сетка v4, валюта USD.
//   3 тарифа на аудиторию (пациенты / врачи / клиники). Цены в долларах.
//   patientsInOffice синхронизирован с PLAN_TO_MAX_PATIENTS в модели User.
//
//   ─── Что изменилось в v4 и почему ─────────────────────────────────
//
//   1. УБРАНА КОМИССИЯ (docpatsCommissionPct). Процент с приёма требует
//      держать чужие деньги в потоке платформы, а это лицензия платёжного
//      посредника либо Stripe Connect — который платит только в США,
//      Британию, ЕЭЗ, Канаду и Швейцарию. Комиссия упирала выплаты врачам
//      в этот список. Без неё достаточно продавца записи (merchant of
//      record), и география перестаёт ограничивать. Врач оставляет себе
//      всё, что заработал; выручка платформы — только подписка.
//      Кода за полем не было ни строчки: оно нигде не читалось.
//
//   2. ЗАКРЫТЫ БЕЗЛИМИТЫ НА ВЫЗОВЫ МОДЕЛИ. Раньше doctor_pro, patient_pro,
//      clinic и clinic_pro имели -1 на разборах, эпикризах, статьях и
//      AI-консультациях. Выручка при этом ограничена ценой тарифа, а
//      расход — ничем: каждый разбор это обращение к claude-opus-5 со
//      стоимостью порядка $0.2–0.9. Пока комиссия существовала, перерасход
//      тяжёлого пользователя частично покрывался оборотом с его приёмов;
//      без комиссии подписка — единственный доход, и потолок обязателен.
//
//      -1 остаётся только там, где обращения к модели нет:
//      examQuestions (свой банк вопросов) и documentExports (свои данные).
//
//      ВАЖНО: числа ниже — ПОТОЛОК на случай аномалии, а не ожидаемое
//      потребление. Обычный врач расходует малую долю.
//
//   3. doctor_pro перестал быть безлимитным по пациентам. Цена за пациента
//      падала до нуля ровно там, где сидят самые загруженные врачи.
// ─────────────────────────────────────────────────────────────────────

// ─── Пациентские планы (USD) ────────────────────────────────────────
// patient_free — Free 0$ — базовый доступ бессрочно
// patient_std  — Plus 9$/мес (90$/год)
// patient_pro  — Pro 19$/мес (190$/год)
//
// ─── Врачебные планы (USD) ──────────────────────────────────────────
// doctor_trial — первые 6 месяцев после регистрации (как Doctor Growth)
// doctor_basic — Start 19$/мес (190$/год)
// doctor_super — Growth 49$/мес (490$/год)
// doctor_pro   — Pro 99$/мес (990$/год)
//
// ─── Клиники (USD) ──────────────────────────────────────────────────
// clinic_start — Start 99$/мес (5 врачей)
// clinic       — Business 249$/мес (15 врачей)
// clinic_pro   — Enterprise 499$/мес (∞ врачей)

export const PLAN_LIMITS = {
  // ═════════════════════ ПАЦИЕНТЫ ═══════════════════════
  guest: {
    examQuestions: 20,
    aiConsultations: 1,
    // Было 1. Гостю статья не положена, раз её нет у зарегистрированного
    // Free: иначе регистрация ухудшала бы условия, а число гостей ничем не
    // ограничено — платить за них некому.
    aiArticles: 0,
    soapEpicrises: 0,
    documentExports: 0,
    bookingDiscount: 0,
  },
  patient_free: {
    examQuestions: 250,
    // Бесплатный уровень — демонстрация, а не продукт: платить за него
    // некому, а расход умножается на каждую регистрацию. Было 5/1/3 —
    // $0,68 в месяц с каждого зарегистрировавшегося.
    aiConsultations: 2,
    aiArticles: 0,
    soapEpicrises: 1,
    documentExports: -1, // -1 = без лимита (свои данные)
    bookingDiscount: 0,
  },
  patient_std: {
    examQuestions: 1000,
    aiConsultations: 10,
    aiArticles: 2,
    soapEpicrises: 10,
    documentExports: -1,
    bookingDiscount: 10, // % скидка на видео-приём с врачом
  },
  patient_pro: {
    examQuestions: -1,
    // Было -1 «безлимит (fair use)». Fair use — не предел, а надежда на
    // добросовестность: при 19 $ выручки сотня консультаций уже съедает
    // тариф целиком. Потолок высокий, обычному пациенту недостижимый.
    aiConsultations: 25,
    aiArticles: 8,
    soapEpicrises: 25,
    documentExports: -1,
    bookingDiscount: 20,
  },

  // ═════════════════════ ВРАЧИ ═══════════════════════════
  // patientsInOffice ДОЛЖЕН совпадать с PLAN_TO_MAX_PATIENTS в users.js.
  // Middleware requireDoctorPatientLimit трактует -1 как безлимит.
  // Пробный период. Был 6 месяцев на лимитах Growth — и это была самая
  // крупная статья расхода всей платформы: до $143 на одного врача, без
  // платёжных данных и без всякой гарантии, что он останется. Сто
  // зарегистрировавшихся стоили до $14 000 ещё до первого доллара выручки.
  //
  // Стало 3 месяца на лимитах Start (значения синхронны с doctor_basic):
  // около $16 на врача. Трёх месяцев достаточно, чтобы понять продукт;
  // шесть месяцев на старшем тарифе — это уже не проба, а бесплатная работа.
  doctor_trial: {
    // Совпадает со Start намеренно: пробный период объявлен «на лимитах
    // Start» и в документации, и на витрине. Меняете здесь — меняйте и там.
    examQuestions: 1500,
    aiAnalyses: 15,
    aiArticles: 4,
    soapEpicrises: 15,
    aiPatientConsultations: 8,
    patientsInOffice: 100,
    videoMinutes: 240,
  },
  // Lite — вход для врачей.
  //
  // Стоил 3 $. При такой цене правило «выручка втрое выше расхода»
  // недостижимо арифметически: 50 ¢ комиссии Paddle плюс 50 ¢
  // инфраструктуры — это доллар постоянных расходов ещё до первого
  // обращения к модели, а трёхкратное покрытие требует трёх долларов, то
  // есть всей цены тарифа при нулевом ИИ. Годовая оплата не спасает:
  // остаётся 17 ¢ в месяц, меньше одного разбора.
  //
  // Поэтому 9 $ — минимальная цена, при которой тариф вообще может быть
  // прибыльным. Взамен лимиты выросли: 30 пациентов вместо 17 и 5 разборов
  // вместо 3, то есть это теперь рабочий тариф, а не витрина.
  doctor_lite: {
    examQuestions: 500,
    aiAnalyses: 5,
    aiArticles: 1,
    soapEpicrises: 5,
    aiPatientConsultations: 3,
    patientsInOffice: 30,
    videoMinutes: 60,
  },
  doctor_basic: {
    // 1500 при банке примерно в 1011 вопросов — квота заведомо больше банка
    // и сегодня не ограничивает ничего. Сделано сознательно: прохождение
    // вопросов не обращается к модели и платформе ничего не стоит, а банк
    // будет расти. Различие тарифов в модуле экзаменов держится на РЕЖИМАХ
    // (см. EXAM_ADDONS ниже), а не на количестве вопросов.
    examQuestions: 1500,
    aiAnalyses: 15,
    aiArticles: 4,
    soapEpicrises: 15,
    aiPatientConsultations: 8,
    patientsInOffice: 100,
    videoMinutes: 240,
  },
  doctor_super: {
    examQuestions: -1,
    aiAnalyses: 40,
    aiArticles: 12,
    soapEpicrises: 40,
    aiPatientConsultations: 30,
    patientsInOffice: 600,
    videoMinutes: 600,
  },
  // Pro. Все безлимиты, кроме банка вопросов, заменены потолками.
  //
  // Пациентов было -1. При 99 $ это означало, что цена за пациента у самых
  // загруженных врачей стремится к нулю: на Growth выходило 8 центов за
  // пациента, на Pro — сколько угодно мало. Пока платформа брала процент с
  // приёмов, объём сам себя окупал; без процента подписка — единственный
  // доход, и «безлимит» превращается в скидку тем, кто пользуется больше
  // всех. 2000 — втрое больше Growth за вдвое большую цену: запас, который
  // реальной практике не выбрать, но конечный.
  doctor_pro: {
    examQuestions: -1,
    aiAnalyses: 100,
    aiArticles: 25,
    soapEpicrises: 100,
    aiPatientConsultations: 60,
    patientsInOffice: 2000,
    videoMinutes: 1200,
  },

  // ═════════════════════ КЛИНИКИ ═════════════════════════
  clinic_start: {
    examQuestions: -1,
    doctors: 5,
    aiAnalyses: 120,
    aiArticles: 25,
    soapEpicrises: 90,
    videoMinutes: 1500,
    analytics: false,
    topInRecommendations: false,
  },
  // Клинические потолки заданы «на врача, помноженное на штат»: Business —
  // 15 врачей, значит ~27 разборов на врача в месяц. Enterprise штат не
  // ограничивает, поэтому именно там безлимит на модель был опаснее всего:
  // неограниченное число врачей, каждый с неограниченным расходом.
  clinic: {
    examQuestions: -1,
    doctors: 15,
    aiAnalyses: 280,
    aiArticles: 80,
    soapEpicrises: 300,
    videoMinutes: 5000,
    analytics: true,
    topInRecommendations: true,
  },
  // Штат перестал быть безлимитным. Пока число врачей не ограничено,
  // расход на инфраструктуру нельзя даже оценить — а значит и проверить,
  // окупается ли тариф. 50 врачей это $25 000 годовой выручки клиники при
  // 499 $ в месяц; кому нужно больше, тому нужен индивидуальный договор,
  // а не строчка в прайсе.
  clinic_pro: {
    examQuestions: -1,
    doctors: 50,
    aiAnalyses: 480,
    aiArticles: 150,
    soapEpicrises: 550,
    videoMinutes: 15000,
    analytics: true,
    topInRecommendations: true,
  },
};

// ─── Цены (USD, месяц/год). Годовая ≈ ×10 месяцев (2 месяца в подарок) ──
// Витрина client/src/pages/PricingPage.jsx (PRICES_USD) должна совпадать.
export const PLAN_PRICES = {
  patient_std: { monthly: 9, yearly: 90 },
  patient_pro: { monthly: 19, yearly: 190 },
  doctor_lite: { monthly: 9, yearly: 90 },
  doctor_basic: { monthly: 19, yearly: 190 },
  doctor_super: { monthly: 49, yearly: 490 },
  doctor_pro: { monthly: 99, yearly: 990 },
  clinic_start: { monthly: 99, yearly: 990 },
  clinic: { monthly: 249, yearly: 2490 },
  clinic_pro: { monthly: 499, yearly: 4990 },
};

// ─── Аддон «Подготовка к экзаменам» ─────────────────────────────────
//
// Отдельная ось поверх основного плана, а не ещё один основной план.
// Причина: у модуля education своя аудитория — студенты и резиденты,
// которым остальной DocPats не нужен, и покупать ради тестов врачебный
// план они не станут. Аддон дешевле любого основного плана, поэтому их
// не каннибализирует, а старшим планам безлимит идёт бонусом (см.
// examQuestions в PLAN_LIMITS) — это аргумент за апгрейд.
//
// Действует ровно одна фича — квота вопросов в месяц. Всё остальное
// (какие тесты видны, какие режимы доступны) определяется планом.
// РАЗЛИЧИЕ ТАРИФОВ — РЕЖИМЫ, А НЕ КОЛИЧЕСТВО.
//
// Раньше Plus продавал 2000 вопросов в месяц, а Unlimited — безлимит. При
// банке примерно в тысячу вопросов обе цифры перекрывают его с запасом, то
// есть тарифы были неразличимы: платить 15 $ вместо 7 $ было не за что.
// Количество перестаёт быть осью, пока банк меньше любой из квот.
//
// Ось теперь — режимы прохождения (ATTEMPT_MODES в
// modules/education/constants.js):
//   tutor — объяснение сразу после ответа, без таймера
//   drill — добивка слабых тем по статистике прошлых попыток
//   timed — таймер, объяснения в конце
//   mock  — полная симуляция экзамена: состав по blueprint, таймер, отчёт
//
// Учиться можно бесплатно (tutor + drill). Платное — репетиция экзамена:
// 7 $ дают работу на время, 15 $ — полную симуляцию с разнарядкой по
// blueprint. Это то, ради чего человек и готовится к экзамену.
export const EXAM_ADDONS = {
  exam_plus: { examQuestions: -1, examModes: ["tutor", "drill", "timed"] },
  exam_unlimited: {
    examQuestions: -1,
    examModes: ["tutor", "drill", "timed", "mock"],
  },
};

// Режимы, доступные без аддона.
//
// Планы с безлимитом вопросов (пробный, Growth, Pro, клиники) получают всё:
// они уже платят за модуль в составе тарифа, и отнимать у них симуляцию
// ради продажи аддона было бы ухудшением для тех, кто платит больше всех.
export const BASE_EXAM_MODES = ["tutor", "drill"];
export const ALL_EXAM_MODES = ["tutor", "drill", "timed", "mock"];

export const EXAM_ADDON_PRICES = {
  exam_plus: { monthly: 7, yearly: 70 },
  exam_unlimited: { monthly: 15, yearly: 150 },
};

export const EXAM_ADDON_DISPLAY_NAMES = {
  exam_plus: "Exam Prep Plus",
  exam_unlimited: "Exam Prep Unlimited",
};

// ─── Валюта тарифов ─────────────────────────────────────────────────
export const PLAN_CURRENCY = "USD";

// ─── Длительность бесплатного trial для врачей ─────────────────────
// Было 180 (6 месяцев). См. пояснение у doctor_trial: полгода на лимитах
// Growth стоили до $143 на врача, из которых платить оставалась малая часть.
export const DOCTOR_TRIAL_DAYS = 90; // 3 месяца

// ─── Helpers ────────────────────────────────────────────────────────

/**
 * Определяет эффективный план юзера с учётом trial-периода и роли.
 * Также корректно обрабатывает legacy-значения в БД.
 *
 * @param {Object} user — документ User из Mongo
 * @returns {String} — ключ плана (patient_free, doctor_trial, etc.)
 */
export function resolveEffectivePlan(user) {
  if (!user) return "guest";

  const role = user.role;
  const stored = user.subscriptionPlan;
  const isPatient = role === "patient" || role === "user";
  const isDoctor = role === "doctor";

  // ─── 1. Новые ключи планов — используем как есть ──────────
  // doctor_lite здесь отсутствовал. Сегодня это ничем не проявлялось —
  // купивший Lite проваливался в fallback ниже, который возвращает ровно
  // doctor_lite. Но совпадение случайное: стоит поменять fallback, и
  // оплаченный тариф молча подменится другим. Платный план обязан
  // распознаваться по своей записи, а не по совпадению с запасным путём.
  const NEW_PAID_PLANS = [
    "patient_std",
    "patient_pro",
    "doctor_lite",
    "doctor_basic",
    "doctor_super",
    "doctor_pro",
    "clinic_start",
    "clinic",
    "clinic_pro",
  ];
  if (stored && NEW_PAID_PLANS.includes(stored)) {
    return stored;
  }

  // ─── 2. Legacy маппинг для существующих юзеров ────────────
  // У старых пациентов в БД могло стоять "standard" или "premium"
  if (isPatient) {
    if (stored === "standard") return "patient_std";
    if (stored === "premium") return "patient_pro";
  }
  // Старый "doctor_free" → переход в trial/basic через шаг 3 ниже
  // Старый "free" → fallback на роль через шаг 3 ниже

  // ─── 3. Fallback по роли ──────────────────────────────────
  if (isPatient) {
    return "patient_free"; // бессрочный free для всех пациентов
  }

  if (isDoctor) {
    // Trial идёт пока trialEndsAt в будущем
    if (user.trialEndsAt && new Date() < new Date(user.trialEndsAt)) {
      return "doctor_trial";
    }
    // После trial — САМЫЙ ДЕШЁВЫЙ платный тариф, а не Start.
    //
    // Раньше здесь стоял doctor_basic (19 $). Правило писалось, когда Lite
    // ещё не существовало — он появился позже и описан в этом же файле
    // «втрое меньше Start», а откат не тронули. Получалось, что врач,
    // не выбиравший вообще ничего, оказывался на тарифе в шесть раз
    // дороже минимального.
    //
    // Молча записывать человека на что-то дороже нижней ступени нельзя.
    // Пациенты при этом не теряются: requireDoctorPatientLimit блокирует
    // только ДОБАВЛЕНИЕ новых, уже заведённые остаются доступны.
    return "doctor_lite";
  }

  if (role === "admin") return "doctor_pro";

  return "patient_free"; // безопасный fallback
}

/**
 * Получить лимит конкретной фичи для конкретного плана.
 * @param {String} planKey
 * @param {String} feature — название фичи (aiConsultations, videoMinutes, etc.)
 * @returns {Number} — лимит или -1 если безлимит, 0 если не определено
 */
export function getLimit(planKey, feature) {
  const plan = PLAN_LIMITS[planKey];
  if (!plan) return 0;
  const limit = plan[feature];
  return limit === undefined ? 0 : limit;
}

/**
 * Активен ли у пользователя аддон подготовки к экзаменам.
 *
 * Аддон живёт отдельно от subscriptionPlan и истекает своим сроком:
 * человек может сидеть на бесплатном patient_free и при этом иметь
 * оплаченный Exam Prep.
 *
 * @param {Object} user — документ User
 * @returns {String|null} — ключ аддона или null
 */
export function resolveExamAddon(user) {
  const key = user?.examAddon;
  if (!key || !EXAM_ADDONS[key]) return null;
  const until = user.examAddonEndsAt ? new Date(user.examAddonEndsAt) : null;
  if (until && new Date() > until) return null; // срок вышел
  return key;
}

/**
 * Итоговая месячная квота вопросов: максимум из плана и аддона.
 *
 * Берём максимум, а не «аддон важнее»: врач на doctor_pro с безлимитом
 * не должен просесть до 2000, если когда-то докупил Exam Prep Plus.
 * -1 (безлимит) выигрывает у любого числа.
 *
 * @param {Object|null} user — документ User; null/undefined = гость
 * @returns {{limit: number, plan: string, addon: string|null}}
 */
export function resolveExamQuestionLimit(user) {
  const plan = user ? resolveEffectivePlan(user) : "guest";
  const planLimit = getLimit(plan, "examQuestions");
  const addon = user ? resolveExamAddon(user) : null;
  if (!addon) return { limit: planLimit, plan, addon: null };

  const addonLimit = EXAM_ADDONS[addon].examQuestions;
  if (planLimit === -1 || addonLimit === -1) {
    return { limit: -1, plan, addon };
  }
  return { limit: Math.max(planLimit, addonLimit), plan, addon };
}

/**
 * Какие режимы прохождения доступны человеку.
 *
 * Режимы складываются, а не выбираются: если план уже даёт всё (безлимит по
 * вопросам), докупленный аддон ничего не отнимает. Гость — только tutor:
 * демо-проход существует, чтобы показать формат, а не чтобы репетировать
 * экзамен.
 *
 * @param {Object|null} user — документ User из Mongo
 * @returns {{ modes: string[], plan: string, addon: string|null }}
 */
export function resolveExamModes(user) {
  const plan = user ? resolveEffectivePlan(user) : "guest";
  if (!user) return { modes: ["tutor"], plan, addon: null };

  const planUnlimited = getLimit(plan, "examQuestions") === -1;
  const addon = resolveExamAddon(user);

  const set = new Set(planUnlimited ? ALL_EXAM_MODES : BASE_EXAM_MODES);
  if (addon) for (const m of EXAM_ADDONS[addon].examModes) set.add(m);

  return {
    modes: ALL_EXAM_MODES.filter((m) => set.has(m)),
    plan,
    addon,
  };
}

/**
 * Маппинг плана на features.maxPatients (для совместимости со старым
 * pre-save хуком и middleware requireDoctorPatientLimit).
 *
 * Используется в pre-save хуке User модели когда меняется
 * subscriptionPlan — чтобы maxPatients автоматически синхронизировался.
 */
export function getMaxPatientsForPlan(planKey) {
  const plan = PLAN_LIMITS[planKey];
  if (!plan) return 5; // default — как у doctor_basic
  const value = plan.patientsInOffice;
  if (value === undefined || value === null) return 5;
  return value;
}

/**
 * Дружелюбное название плана для UI.
 */
export const PLAN_DISPLAY_NAMES = {
  guest: "Гость",
  patient_free: "Patient Free",
  patient_std: "Patient Plus",
  patient_pro: "Patient Pro",
  doctor_trial: "Doctor Growth (trial)",
  // doctor_lite забыли добавить сюда вместе с самим тарифом: quota.service
  // берёт имя как PLAN_DISPLAY_NAMES[plan] ?? plan, и врач видел в
  // интерфейсе сырой ключ «doctor_lite».
  doctor_lite: "Doctor Lite",
  doctor_basic: "Doctor Start",
  doctor_super: "Doctor Growth",
  doctor_pro: "Doctor Pro",
  clinic_start: "Clinic Start",
  clinic: "Clinic Business",
  clinic_pro: "Clinic Enterprise",
};
