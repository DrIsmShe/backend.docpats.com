// server/common/config/aiPlanLimits.js
// ─────────────────────────────────────────────────────────────────────
//   ЕДИНЫЙ ИСТОЧНИК ПРАВДЫ для всех тарифных лимитов в DocPats.
//
//   Используется во всех AI-сервисах: user-synthesis, consultation-ai,
//   SOAP-генератор и т.д. Если меняешь лимит — меняй ТОЛЬКО здесь.
//
//   Обновлено: 2026-05-03 — стратегия А
//   patientsInOffice синхронизирован с pre-save хуком User модели
//   (5/50/1000) чтобы requireDoctorPatientLimit middleware
//   продолжал работать через features.maxPatients без изменений.
// ─────────────────────────────────────────────────────────────────────

// ─── Пациентские планы ──────────────────────────────────────────────
// guest        — неавторизованный посетитель (нет userId)
// patient_free — зарегистрированный пациент бессрочно
// patient_std  — Standard 9 AZN/мес (или 86 AZN/год -20%)
// patient_pro  — Pro 19 AZN/мес (или 182 AZN/год -20%)
//
// ─── Врачебные планы ────────────────────────────────────────────────
// doctor_trial — первые 6 месяцев после регистрации (как Doctor Super)
// doctor_basic — Basic 6 AZN/мес — базовое присутствие после trial
// doctor_super — Super 23 AZN/мес — растущая практика
// doctor_pro   — Pro 49 AZN/мес — полный инструментарий
//
// ─── Клиники ────────────────────────────────────────────────────────
// clinic_start — Start 99 AZN/мес (5 врачей)
// clinic       — Clinic 149 AZN/мес (10 врачей)
// clinic_pro   — Medical Center 299 AZN/мес (∞ врачей)

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
    aiConsultations: 7,
    aiArticles: 1,
    soapEpicrises: 7,
    documentExports: -1, // -1 = без лимита (свои данные)
    bookingDiscount: 0,
  },
  patient_std: {
    aiConsultations: 20,
    aiArticles: 3,
    soapEpicrises: 20,
    documentExports: -1,
    bookingDiscount: 10, // % скидка на видео-приём с врачом
  },
  patient_pro: {
    aiConsultations: 60,
    aiArticles: 10,
    soapEpicrises: 60,
    documentExports: -1,
    bookingDiscount: 20,
  },

  // ═════════════════════ ВРАЧИ ═══════════════════════════
  // patientsInOffice выставлен 5/50/1000 для совместимости
  // с существующим requireDoctorPatientLimit middleware,
  // который читает features.maxPatients.
  doctor_trial: {
    // Первые 6 месяцев — даём как Doctor Super.
    aiAnalyses: 30,
    aiArticles: 10,
    soapEpicrises: 30,
    aiPatientConsultations: 30,
    patientsInOffice: 50,
    videoMinutes: 600,
    docpatsCommissionPct: 12,
  },
  doctor_basic: {
    aiAnalyses: 7,
    aiArticles: 3,
    soapEpicrises: 7,
    aiPatientConsultations: 5,
    patientsInOffice: 5,
    videoMinutes: 30,
    docpatsCommissionPct: 15,
  },
  doctor_super: {
    aiAnalyses: 30,
    aiArticles: 10,
    soapEpicrises: 30,
    aiPatientConsultations: 30,
    patientsInOffice: 50,
    videoMinutes: 600,
    docpatsCommissionPct: 12,
  },
  doctor_pro: {
    aiAnalyses: 100,
    aiArticles: 30,
    soapEpicrises: 100,
    aiPatientConsultations: -1, // ∞ AI-консультаций
    patientsInOffice: 1000, // практически ∞
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
    doctors: 10,
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

// ─── Цены (для отображения и проверок) ──────────────────────────────
export const PLAN_PRICES = {
  patient_std: {
    monthly: 5,
    yearly: 48,
    currencyAZN: { monthly: 9, yearly: 86 },
  },
  patient_pro: {
    monthly: 11,
    yearly: 106,
    currencyAZN: { monthly: 19, yearly: 182 },
  },
  doctor_basic: {
    monthly: 3.5,
    yearly: 34,
    currencyAZN: { monthly: 6, yearly: 58 },
  },
  doctor_super: {
    monthly: 13,
    yearly: 125,
    currencyAZN: { monthly: 23, yearly: 220 },
  },
  doctor_pro: {
    monthly: 29,
    yearly: 278,
    currencyAZN: { monthly: 49, yearly: 470 },
  },
  clinic_start: {
    monthly: 59,
    yearly: 566,
    currencyAZN: { monthly: 99, yearly: 950 },
  },
  clinic: {
    monthly: 99,
    yearly: 950,
    currencyAZN: { monthly: 149, yearly: 1430 },
  },
  clinic_pro: {
    monthly: 199,
    yearly: 1910,
    currencyAZN: { monthly: 299, yearly: 2870 },
  },
};

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
  patient_std: "Patient Standard",
  patient_pro: "Patient Pro",
  doctor_trial: "Doctor Free (trial)",
  doctor_basic: "Doctor Basic",
  doctor_super: "Doctor Super",
  doctor_pro: "Doctor Pro",
  clinic_start: "Clinic Start",
  clinic: "Clinic",
  clinic_pro: "Medical Center",
};
