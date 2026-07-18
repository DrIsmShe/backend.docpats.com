// server/common/config/aiPlanLimits.js
// ─────────────────────────────────────────────────────────────────────
//   ЕДИНЫЙ ИСТОЧНИК ПРАВДЫ для всех тарифных лимитов в DocPats.
//
//   Используется во всех AI-сервисах: user-synthesis, consultation-ai,
//   SOAP-генератор и т.д. Если меняешь лимит — меняй ТОЛЬКО здесь.
//
//   Обновлено: 2026-07-18 — тарифная сетка v3, валюта USD.
//   3 тарифа на аудиторию (пациенты / врачи / клиники). Цены в долларах.
//   patientsInOffice синхронизирован с PLAN_TO_MAX_PATIENTS в модели User.
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
    aiConsultations: 1,
    aiArticles: 1,
    soapEpicrises: 0,
    documentExports: 0,
    bookingDiscount: 0,
  },
  patient_free: {
    aiConsultations: 5,
    aiArticles: 1,
    soapEpicrises: 3,
    documentExports: -1, // -1 = без лимита (свои данные)
    bookingDiscount: 0,
  },
  patient_std: {
    aiConsultations: 30,
    aiArticles: 5,
    soapEpicrises: 20,
    documentExports: -1,
    bookingDiscount: 10, // % скидка на видео-приём с врачом
  },
  patient_pro: {
    aiConsultations: -1, // безлимит (fair use)
    aiArticles: 20,
    soapEpicrises: -1,
    documentExports: -1,
    bookingDiscount: 20,
  },

  // ═════════════════════ ВРАЧИ ═══════════════════════════
  // patientsInOffice ДОЛЖЕН совпадать с PLAN_TO_MAX_PATIENTS в users.js.
  // Middleware requireDoctorPatientLimit трактует -1 как безлимит.
  doctor_trial: {
    // Первые 6 месяцев — даём как Doctor Growth.
    aiAnalyses: 50,
    aiArticles: 15,
    soapEpicrises: 50,
    aiPatientConsultations: 50,
    patientsInOffice: 500,
    videoMinutes: 600,
    docpatsCommissionPct: 12,
  },
  doctor_basic: {
    aiAnalyses: 10,
    aiArticles: 3,
    soapEpicrises: 10,
    aiPatientConsultations: 5,
    patientsInOffice: 50,
    videoMinutes: 120,
    docpatsCommissionPct: 15,
  },
  doctor_super: {
    aiAnalyses: 50,
    aiArticles: 15,
    soapEpicrises: 50,
    aiPatientConsultations: 50,
    patientsInOffice: 500,
    videoMinutes: 600,
    docpatsCommissionPct: 12,
  },
  doctor_pro: {
    aiAnalyses: -1,
    aiArticles: -1,
    soapEpicrises: -1,
    aiPatientConsultations: -1, // ∞ AI-консультаций
    patientsInOffice: -1, // безлимит (middleware понимает -1)
    videoMinutes: 1500,
    docpatsCommissionPct: 10,
  },

  // ═════════════════════ КЛИНИКИ ═════════════════════════
  clinic_start: {
    doctors: 5,
    aiAnalyses: 100,
    aiArticles: 30,
    soapEpicrises: 100,
    videoMinutes: 1500,
    analytics: false,
    topInRecommendations: false,
    docpatsCommissionPct: 10,
  },
  clinic: {
    doctors: 15,
    aiAnalyses: -1,
    aiArticles: -1,
    soapEpicrises: -1,
    videoMinutes: 5000,
    analytics: true,
    topInRecommendations: true,
    docpatsCommissionPct: 7,
  },
  clinic_pro: {
    doctors: -1,
    aiAnalyses: -1,
    aiArticles: -1,
    soapEpicrises: -1,
    videoMinutes: -1,
    analytics: true,
    topInRecommendations: true,
    docpatsCommissionPct: 5,
  },
};

// ─── Цены (USD, месяц/год). Годовая ≈ ×10 месяцев (2 месяца в подарок) ──
// Витрина client/src/pages/PricingPage.jsx (PRICES_USD) должна совпадать.
export const PLAN_PRICES = {
  patient_std: { monthly: 9, yearly: 90 },
  patient_pro: { monthly: 19, yearly: 190 },
  doctor_basic: { monthly: 19, yearly: 190 },
  doctor_super: { monthly: 49, yearly: 490 },
  doctor_pro: { monthly: 99, yearly: 990 },
  clinic_start: { monthly: 99, yearly: 990 },
  clinic: { monthly: 249, yearly: 2490 },
  clinic_pro: { monthly: 499, yearly: 4990 },
};

// ─── Валюта тарифов ─────────────────────────────────────────────────
export const PLAN_CURRENCY = "USD";

// ─── Длительность бесплатного trial для врачей ─────────────────────
export const DOCTOR_TRIAL_DAYS = 180; // 6 месяцев

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
  const NEW_PAID_PLANS = [
    "patient_std",
    "patient_pro",
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
    return "doctor_basic"; // после trial — платный basic
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
  doctor_basic: "Doctor Start",
  doctor_super: "Doctor Growth",
  doctor_pro: "Doctor Pro",
  clinic_start: "Clinic Start",
  clinic: "Clinic Business",
  clinic_pro: "Clinic Enterprise",
};
