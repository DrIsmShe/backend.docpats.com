// server/common/standards/labStandards.js
//
// ЕДИНЫЙ СТАНДАРТ-СЛОЙ для лабораторных данных (Вариант X).
// Импортируется ОБОИМИ контурами: новым LabResult (clinic-medical) и
// старым LabTest (polyclinic) — без слияния хранилищ и без миграции.
//
// Содержит:
//   • LOINC_MAP   — коды LOINC для показателей твоих 20 панелей       [#1]
//   • computeFlag — интерпретация value vs referenceRange             [#2]
//   • UCUM_CANON  — канонизация единиц измерения                      [#8]
//
// Принцип: «единство» = общая терминология и общая логика, а НЕ одна
// mongoose-модель. Системы уровня Epic/Cerner строятся так же.

// ─────────────────────────────────────────────────────────────────────────
//  #1 — LOINC-коды
//  Ключ совпадает с `name` в labtestParameterTemplates.jsx.
//  Источник: loinc.org (наиболее частые коды для quantitative serum/plasma).
//  Покрыты не все показатели — недостающие вернут null, это нормально.
//  Маппинг по имени регистронезависимый (см. loincFor()).
// ─────────────────────────────────────────────────────────────────────────
export const LOINC_MAP = {
  // BloodTestGeneral (CBC)
  hemoglobin: "718-7",
  erythrocytes: "789-8", // RBC count
  leukocytes: "6690-2", // WBC count (blood)
  platelets: "777-3",

  // BloodTestBiochemistry / Renal / Liver
  glucose: "2345-7", // serum glucose
  creatinine: "2160-0",
  urea: "3094-0", // BUN
  alt: "1742-6",
  ast: "1920-8",
  alp: "6768-6",
  ggt: "2324-2",
  "total bilirubin": "1975-2",
  "direct bilirubin": "1968-7",
  albumin: "1751-7",
  egfr: "33914-3",
  sodium: "2951-2",
  potassium: "2823-3",
  chloride: "2075-0",
  magnesium: "19123-9",

  // Lipids
  "total cholesterol": "2093-3",
  "ldl-c": "13457-7",
  "hdl-c": "2085-9",
  triglycerides: "2571-8",
  apob: "1884-6",
  "lp(a)": "10835-7",

  // Diabetes
  "fasting glucose": "1558-6",
  hba1c: "4548-4",
  insulin: "20448-7",
  "c-peptide": "1986-9",

  // Thyroid / Hormones
  tsh: "11580-8",
  "free t4": "3024-7",
  "free t3": "3051-0",
  "anti-tpo": "8099-8",
  "anti-tg": "8098-0",

  // Iron studies
  iron: "2498-4",
  ferritin: "2276-4",
  tibc: "2500-7",
  "transferrin saturation": "2502-3",

  // Coagulation
  pt: "5902-2",
  inr: "6301-6",
  aptt: "3173-2",
  fibrinogen: "3255-7",
  "d-dimer": "48065-7",

  // Cardiac
  "troponin i/t": "10839-9",
  "ck-mb": "13969-1",
  "nt-probnp": "33762-6",

  // Vitamins / trace
  "vitamin d (25-oh)": "1989-3",
  "vitamin b12": "2132-9",
  folate: "2284-8",
  zinc: "5763-8",

  // Immunology
  igg: "2465-3",
  iga: "2458-8",
  igm: "2472-9",

  // Tumor markers
  cea: "2039-6",
  "ca 125": "10334-1",
  "ca 19-9": "24108-3",

  // Urinalysis
  ph: "5803-2",
  protein: "5804-0",
  "specific gravity": "5811-5",

  // Infectious serology (qualitative)
  hbsag: "5196-1",
  "anti-hbs": "16935-9",
  "anti-hcv": "16128-1",
  "hiv ag/ab": "56888-1",
  "rpr/vdrl": "20507-0",

  // Urine ACR
  "urine albumin": "14957-5",
  "urine creatinine": "2161-8",
  acr: "9318-7",

  // Stool inflammation
  calprotectin: "38445-3",
  "occult blood (fit)": "27396-1",
};

/**
 * LOINC-код по имени показателя (регистронезависимо).
 * @returns {string|null}
 */
export function loincFor(name) {
  if (!name) return null;
  return LOINC_MAP[String(name).trim().toLowerCase()] || null;
}

// ─────────────────────────────────────────────────────────────────────────
//  #8 — Канонизация единиц (UCUM-нотация).
//  Приводит частые варианты записи к каноничному виду.
// ─────────────────────────────────────────────────────────────────────────
const UCUM_ALIASES = {
  "g/l": "g/L",
  "mg/dl": "mg/dL",
  "mmol/l": "mmol/L",
  "umol/l": "µmol/L",
  "µmol/l": "µmol/L",
  "u/l": "U/L",
  "iu/ml": "IU/mL",
  "miu/ml": "mIU/mL",
  "µiu/ml": "µIU/mL",
  "uiu/ml": "µIU/mL",
  "pmol/l": "pmol/L",
  "ng/ml": "ng/mL",
  "pg/ml": "pg/mL",
  "ng/l": "ng/L",
  "10^9/l": "10*9/L",
  "10^12/l": "10*12/L",
  "%": "%",
  sec: "s",
};

export function canonUnit(unit) {
  if (!unit) return unit;
  const key = String(unit).trim().toLowerCase();
  return UCUM_ALIASES[key] || unit;
}

// ─────────────────────────────────────────────────────────────────────────
//  #2 — computeFlag: интерпретация показателя.
//
//  Правила (MVP, как договорились):
//   • text-показатель: норма берётся из referenceRange.text.
//       совпало → "normal", иначе → "abnormal".
//       Если эталона нет — "normal" (не пугаем пациента без основания).
//   • number-показатель:
//       в [min,max]                         → "normal"
//       > max, но ≤ max*critFactor          → "high"
//       > max*critFactor                    → "critical_high"
//       < min, но ≥ min*(2-critFactor)      → "low"  (т.е. в пределах ~50% ниже)
//       < min*(2-critFactor)                → "critical_low"
//   • если граница не задана (только min или только max) — проверяем доступную.
//   • critFactor по умолчанию 1.5 (>150% верхней / <50% нижней = критично).
// ─────────────────────────────────────────────────────────────────────────
export function computeFlag(param, opts = {}) {
  const critFactor = opts.critFactor ?? 1.5;

  if (!param) return "normal";

  // ── Текстовые ──
  if (param.valueType === "text") {
    const ref = param.referenceRange?.text;
    if (!ref) return "normal";
    const val = String(param.value ?? "")
      .trim()
      .toLowerCase();
    const refVal = String(ref).trim().toLowerCase();
    return val === refVal ? "normal" : "abnormal";
  }

  // ── Числовые ──
  const v = Number(param.value);
  if (!Number.isFinite(v)) return "normal";

  const min = param.referenceRange?.min;
  const max = param.referenceRange?.max;
  const hasMin = min != null && Number.isFinite(Number(min));
  const hasMax = max != null && Number.isFinite(Number(max));

  if (!hasMin && !hasMax) return "normal";

  if (hasMax) {
    const mx = Number(max);
    if (v > mx) {
      const critHi = mx * critFactor;
      return v > critHi ? "critical_high" : "high";
    }
  }
  if (hasMin) {
    const mn = Number(min);
    if (v < mn) {
      // критично, если ниже mn*(2-critFactor): при 1.5 → ниже 50% от min
      const critLo = mn * (2 - critFactor);
      return v < critLo ? "critical_low" : "low";
    }
  }

  return "normal";
}

/** true, если flag означает отклонение (для подсветки/счётчиков). */
export function isAbnormalFlag(flag) {
  return flag && flag !== "normal";
}

/** true, если flag критический (красная подсветка пациенту). */
export function isCriticalFlag(flag) {
  return flag === "critical_high" || flag === "critical_low";
}

export default {
  LOINC_MAP,
  loincFor,
  canonUnit,
  computeFlag,
  isAbnormalFlag,
  isCriticalFlag,
};
