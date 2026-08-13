// server/modules/me/specialtyFeedMap.js
//
// Специальность врача → раздел ленты медицинских новостей.
//
// ЗАЧЕМ ОТДЕЛЬНЫЙ СЛОВАРЬ. В справочнике проекта 101 специализация, и это
// НАЗВАНИЯ ПРОФЕССИЙ («Phthisiatrician», «Oculoplastic Surgeon»). Лента
// новостей размечена иначе — примерно тремя десятками предметных областей
// («infectious», «ophthalmology»). Одно к одному они не ложатся: у фтизиатра
// нет своего раздела, зато туберкулёз — это инфекции.
//
// Словарь ведём на сервере, а не на клиенте: клиенту незачем знать все 101
// название, ему нужен один ключ для запроса к ленте.
//
// ЧЕГО ЗДЕСЬ НЕТ. Ни одна профессия не отображается «примерно»: если
// подходящего раздела нет (клинический фармаколог, судмедэксперт), ключ не
// выдаётся вовсе и врач видит общую ленту. Подсунуть человеку чужой раздел
// хуже, чем показать всё: он решит, что по его специальности ничего не пишут.

/**
 * Ключи разделов ленты. Совпадают со значениями поля specialty в базе
 * новостей (DOCPATS_AI_NEWS) — они уходят в запрос как есть.
 */
const MAP = Object.freeze({
  // ── Терапевтические ──
  Pulmonologist: "pulmonology",
  Nephrologist: "nephrology",
  // Фтизиатр лечит туберкулёз — это инфекционная патология.
  Phthisiatrician: "infectious",
  Hepatologist: "gastroenterology",
  Dermatologist: "dermatology",
  Endocrinologist: "endocrinology",
  "Infectious Disease Specialist": "infectious",
  Urologist: "urology",
  Gastroenterologist: "gastroenterology",
  Cardiologist: "cardiology",
  Hematologist: "hematology",
  "Interventional Cardiologist": "cardiology",
  "Pediatric Cardiologist": "cardiology",
  Rheumatologist: "rheumatology",
  "Allergist-Immunologist": "allergy",
  Immunotherapist: "allergy",
  "Medical Geneticist": "genetics",
  // Сон — предмет неврологии в большей степени, чем чего-либо ещё.
  "Sleep Medicine Specialist": "neurology",
  "Pain Management Specialist": "anesthesiology",

  // ── Педиатрия ──
  Pediatrician: "pediatrics",
  Neonatologist: "pediatrics",
  "Child Psychiatrist": "psychiatry",
  "Pediatric Neurologist": "neurology",
  "Pediatric Oncologist": "oncology",
  "Pediatric Endocrinologist": "endocrinology",

  // ── Женское здоровье ──
  Gynecologist: "gynecology",
  Obstetrician: "gynecology",
  "Menopause Specialist": "gynecology",
  "Reproductive Endocrinologist": "gynecology",
  "Gynecologic Oncologist": "oncology",
  "Breast Specialist": "oncology",

  // ── Хирургия ──
  //
  // Большинство хирургических профессий ведём в общий раздел «surgery»:
  // публикаций по каждой узкой хирургии слишком мало, чтобы раздел не
  // выглядел пустым. Исключения — там, где предметная область явно своя.
  "Plastic Surgeon": "surgery",
  "Bariatric Surgeon": "surgery",
  Neurosurgeon: "surgery",
  "Robotic Surgeon": "surgery",
  "Cardiac Surgeon": "surgery",
  "Thoracic Surgeon": "surgery",
  "Abdominal Surgeon": "surgery",
  "Purulent Surgeon": "surgery",
  "Vascular Surgeon": "surgery",
  "Transplant Surgeon": "surgery",
  "Endocrine Surgeon": "surgery",
  Coloproctologist: "gastroenterology",
  "Orthopedic Trauma Surgeon": "orthopedics",
  "Oral Surgeon": "dentistry",
  "Maxillofacial Surgeon": "dentistry",
  "Oculoplastic Surgeon": "ophthalmology",

  // ── Онкология ──
  Oncologist: "oncology",
  "Oncologist-Chemotherapist": "oncology",
  "Oncologist-Radiotherapist": "oncology",

  // ── Психика и нервная система ──
  Neurologist: "neurology",
  Psychiatrist: "psychiatry",
  Psychotherapist: "psychiatry",
  Psychologist: "psychiatry",
  "Addiction Specialist": "psychiatry",

  // ── Мужское здоровье ──
  Andrologist: "urology",
  Sexologist: "urology",

  // ── Диагностика ──
  Radiologist: "radiology",
  "Ultrasound Diagnostician": "radiology",
  "Medical Imaging Specialist": "radiology",
  Geneticist: "genetics",
  "Molecular Diagnostics Specialist": "genetics",

  // ── Глаза и ЛОР ──
  Ophthalmologist: "ophthalmology",
  "Neuro-ophthalmologist": "ophthalmology",
  Oculist: "ophthalmology",
  Otolaryngologist: "ent",

  // ── Стоматология ──
  Dentist: "dentistry",
  Orthodontist: "dentistry",
  Prosthodontist: "dentistry",
  Endodontist: "dentistry",
  Periodontist: "dentistry",
  "Oral Pathologist": "dentistry",
  "Dental Hygienist": "dentistry",

  // ── Реабилитация ──
  Physiotherapist: "rehabilitation",
  "Occupational Therapist": "rehabilitation",
  "Exercise Therapy Doctor": "rehabilitation",
  Osteopath: "rehabilitation",
  Chiropractor: "rehabilitation",
  Acupuncturist: "rehabilitation",
  "Speech Therapist": "rehabilitation",
  "Rehabilitation Psychologist": "rehabilitation",

  // ── Неотложная помощь ──
  "Emergency Medicine Doctor": "emergency",
  "Disaster Medicine Specialist": "emergency",
  "Triage Specialist": "emergency",
  Toxicologist: "emergency",

  // ── Спортивная медицина ──
  "Sports Doctor": "sports_medicine",
  "Athletic Trainer": "sports_medicine",
  Kinesiologist: "sports_medicine",
});

// Профессии широкого профиля и те, чьей предметной области в ленте нет.
// Перечислены явно, чтобы отличать «решили показывать всё» от «забыли внести».
const NO_SECTION = new Set([
  "Therapist",
  "Family Doctor",
  "Internal Medicine Doctor",
  "Geriatrician",
  "Dietitian",
  "Occupational Medicine Doctor",
  "Clinical Pharmacologist",
  "Pathologist",
  "Cytologist",
  "Oral Pathologist",
  "Biochemist",
  "Laboratory Diagnostics Specialist",
  "Functional Diagnostics Specialist",
  "Forensic Medical Examiner",
]);

/**
 * Раздел ленты для названия специализации.
 *
 * @param {string} name название из справочника specializations
 * @returns {string|null} ключ раздела либо null — тогда показываем всю ленту
 */
export function feedSectionFor(name) {
  const clean = String(name || "").trim();
  if (!clean) return null;
  if (NO_SECTION.has(clean)) return null;
  return MAP[clean] || null;
}

export default { feedSectionFor };
