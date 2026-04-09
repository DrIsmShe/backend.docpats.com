import OpenAI from "openai";
import { compressMedicalData } from "../utils/compressMedicalData.js";
import AISummaryCache from "../model/AISummaryCache.js";
import { hashPatientData } from "../utils/hashPatientData.js";
import { generatePrognosis } from "../engines/prognosisEngine.js";
import { generateExplainability } from "../engines/explainabilityEngine.js";
import { calculateCompleteness } from "../engines/completenessEngine.js";
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const RISK_DOMAINS = [
  "cardiology",
  "pulmonology",
  "neurology",
  "gastroenterology",
  "hepatology",
  "nephrology",
  "endocrinology",
  "hematology",
  "infectious",
  "rheumatology",
  "dermatology",
  "urology",
  "gynecology",
  "ent",
  "ophthalmology",
  "oncology",
];

export const generateSummary = async (patientData, language = "en") => {
  /* =========================
     🌍 LANGUAGE SUPPORT
  ========================== */

  const languageMap = {
    en: "English",
    ru: "Russian",
    az: "Azerbaijani",
    tr: "Turkish",
    ar: "Arabic",
  };

  const targetLanguage = languageMap[language] || "English";

  /* =========================
     🧹 SAFE HELPERS
  ========================== */

  const safeArray = (val) => (Array.isArray(val) ? val : []);
  const safeValue = (val) => (val !== undefined ? val : null);

  const safeRiskLevel = (val) =>
    ["low", "moderate", "high"].includes(val) ? val : "low";

  const safeConfidence = (val) =>
    typeof val === "number" && Number.isFinite(val) && val >= 0 && val <= 1
      ? val
      : 0;

  const normalizeRiskNode = (node) => {
    if (!node || typeof node !== "object") {
      return {
        level: "low",
        reasons: [],
        confidence: 0,
      };
    }

    return {
      level: safeRiskLevel(node.level),
      reasons: safeArray(node.reasons),
      confidence: safeConfidence(node.confidence),
    };
  };

  const buildEmptySummary = () => ({
    mainComplaints: [],
    historyOfPresentIllness: "",
    objectiveFindings: [],

    organSystems: {
      cardiovascular: [],
      respiratory: [],
      nervous: [],
      gastrointestinal: [],
      genitourinary: [],
      ent: [],
      other: [],
    },

    dynamics: [],
    riskFactors: [],
    background: [],

    keyDiagnostics: {
      angiography: [],
      labAbnormalities: [],
      imagingSummary: [],
    },

    /* ✅ старый формат — НЕ ЛОМАЕМ фронт */
    riskAssessment: {
      cardiovascular: "low",
      pulmonary: "low",
      neurological: "low",
      oncology: "low",
    },

    /* ✅ новый профессиональный формат */
    fullRiskAssessment: Object.fromEntries(
      RISK_DOMAINS.map((domain) => [
        domain,
        {
          level: "low",
          reasons: [],
          confidence: 0,
        },
      ]),
    ),

    priorityRisks: [],
    clinicalAlerts: [],

    followUpRecommendations: [],
    clinicalSeverity: "low",
    aiConfidence: 0,
  });

  /* =========================
     📦 COMPRESS PATIENT DATA
  ========================== */

  const sanitizedPatientData = compressMedicalData(patientData);
  const dataHash = hashPatientData(sanitizedPatientData);
  const patientId = patientData?._id || patientData?.patientId || null;

  /* =========================
     🧠 CACHE LOOKUP
  ========================== */

  let cached = null;

  if (patientId) {
    try {
      cached = await AISummaryCache.findOne({
        patientId,
        dataHash,
      });
    } catch (err) {
      console.error("AI cache lookup error:", err.message);
    }
  }

  if (cached?.summary) {
    console.log("AI cache hit");
    return cached.summary;
  }

  /* =========================
     SAFE JSON STRINGIFY
  ========================== */

  let jsonData = "{}";

  try {
    jsonData = JSON.stringify(sanitizedPatientData);
  } catch (err) {
    console.error("AI stringify error:", err);
    jsonData = "{}";
  }

  /* =========================
     🧠 PROMPT
  ========================== */

  const prompt = `
You are a conservative clinical assistant.

You receive structured patient data in JSON:

${jsonData}

IMPORTANT:
Return ONLY valid JSON.
Do NOT return markdown.
Do NOT include explanations.
Do NOT include backticks.
Return all text fields in ${targetLanguage}.

You MUST analyze every provided examination array.
If any array contains data, it MUST be reflected where appropriate in:
- organSystems
- keyDiagnostics.imagingSummary
- keyDiagnostics.labAbnormalities
- dynamics
- riskAssessment
- fullRiskAssessment
- priorityRisks
- clinicalAlerts

Do not ignore non-cardiac findings.

=========================
LEGACY RISK ASSESSMENT
=========================

Return riskAssessment in this backward-compatible format:

- cardiovascular
- pulmonary
- neurological
- oncology

Each must be:
"low" | "moderate" | "high"

Use ONLY the provided data.

=========================
FULL CLINICAL RISK MAP
=========================

Also return fullRiskAssessment for these domains:

- cardiology
- pulmonology
- neurology
- gastroenterology
- hepatology
- nephrology
- endocrinology
- hematology
- infectious
- rheumatology
- dermatology
- urology
- gynecology
- ent
- ophthalmology
- oncology

For each domain, return:
- level
- reasons
- confidence

Risk levels meaning:
- "low" = no clear evidence of clinically significant risk in provided data
- "moderate" = limited, partial, or indirect signs of possible pathology
- "high" = strong or repeated evidence of significant pathology

Rules:
- reasons must be short
- reasons must be conservative
- reasons must not invent diagnoses
- confidence must be between 0 and 1
- if data is absent, use low risk, empty reasons, low confidence

=========================
PRIORITY RISKS
=========================

Return priorityRisks as top 1 to 3 clinically most relevant risk domains.

Each item must contain:
- domain
- level
- reason

Only include meaningful items.

=========================
CLINICAL ALERTS
=========================

Generate clinicalAlerts only when the provided data contains findings that may require increased physician attention.

Alert levels meaning:
- "low" = mild signal, worth attention
- "moderate" = important finding, physician review advised
- "high" = serious finding, urgent physician attention may be needed

Rules for alerts:
- Do not invent facts
- Do not over-alert if the data is weak
- source should indicate the main source (ct, mri, angiography, lab, ekg, medicalHistory, etc.)
- If there are no meaningful alerts, return an empty array

=========================
STRICT OUTPUT FORMAT
=========================

{
  "mainComplaints": string[],
  "historyOfPresentIllness": string,
  "objectiveFindings": string[],

  "organSystems": {
    "cardiovascular": string[],
    "respiratory": string[],
    "nervous": string[],
    "gastrointestinal": string[],
    "genitourinary": string[],
    "ent": string[],
    "other": string[]
  },

  "dynamics": string[],
  "riskFactors": string[],
  "background": string[],

  "keyDiagnostics": {
    "angiography": string[],
    "labAbnormalities": string[],
    "imagingSummary": string[]
  },

  "riskAssessment": {
    "cardiovascular": "low" | "moderate" | "high",
    "pulmonary": "low" | "moderate" | "high",
    "neurological": "low" | "moderate" | "high",
    "oncology": "low" | "moderate" | "high"
  },

  "fullRiskAssessment": {
    "cardiology": {
      "level": "low" | "moderate" | "high",
      "reasons": string[],
      "confidence": number
    },
    "pulmonology": {
      "level": "low" | "moderate" | "high",
      "reasons": string[],
      "confidence": number
    },
    "neurology": {
      "level": "low" | "moderate" | "high",
      "reasons": string[],
      "confidence": number
    },
    "gastroenterology": {
      "level": "low" | "moderate" | "high",
      "reasons": string[],
      "confidence": number
    },
    "hepatology": {
      "level": "low" | "moderate" | "high",
      "reasons": string[],
      "confidence": number
    },
    "nephrology": {
      "level": "low" | "moderate" | "high",
      "reasons": string[],
      "confidence": number
    },
    "endocrinology": {
      "level": "low" | "moderate" | "high",
      "reasons": string[],
      "confidence": number
    },
    "hematology": {
      "level": "low" | "moderate" | "high",
      "reasons": string[],
      "confidence": number
    },
    "infectious": {
      "level": "low" | "moderate" | "high",
      "reasons": string[],
      "confidence": number
    },
    "rheumatology": {
      "level": "low" | "moderate" | "high",
      "reasons": string[],
      "confidence": number
    },
    "dermatology": {
      "level": "low" | "moderate" | "high",
      "reasons": string[],
      "confidence": number
    },
    "urology": {
      "level": "low" | "moderate" | "high",
      "reasons": string[],
      "confidence": number
    },
    "gynecology": {
      "level": "low" | "moderate" | "high",
      "reasons": string[],
      "confidence": number
    },
    "ent": {
      "level": "low" | "moderate" | "high",
      "reasons": string[],
      "confidence": number
    },
    "ophthalmology": {
      "level": "low" | "moderate" | "high",
      "reasons": string[],
      "confidence": number
    },
    "oncology": {
      "level": "low" | "moderate" | "high",
      "reasons": string[],
      "confidence": number
    }
  },

  "priorityRisks": [
    {
      "domain": string,
      "level": "low" | "moderate" | "high",
      "reason": string
    }
  ],

  "clinicalAlerts": [
    {
      "level": "low" | "moderate" | "high",
      "title": string,
      "message": string,
      "source": string
    }
  ],

  "followUpRecommendations": string[],
  "clinicalSeverity": "low" | "moderate" | "high",
  "aiConfidence": number
}

Rules:
- Do NOT invent data
- If data is missing, return empty arrays for lists
- If a risk cannot be supported by data, use "low"
- Be conservative
- Do not prescribe medications
- Do not claim confirmed diagnosis unless explicitly present in the data
`;

  /* =========================
     🚀 OPENAI CALL
  ========================== */

  let completion = null;

  try {
    completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      temperature: 0.3,
      messages: [
        {
          role: "system",
          content:
            "You are a conservative medical assistant. You never fabricate data. You must analyze all provided arrays. You must return only valid JSON and follow the exact output schema.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
    });
  } catch (err) {
    console.error("OpenAI request error:", err?.message || err);
    return buildEmptySummary();
  }

  /* =========================
     📥 PARSE RESPONSE
  ========================== */

  let structuredSummary = null;

  try {
    structuredSummary = JSON.parse(
      completion?.choices?.[0]?.message?.content || "{}",
    );
  } catch (err) {
    console.error("AI JSON parse error:", err);
    structuredSummary = null;
  }

  /* =========================
     🛡 SAFE FALLBACKS
  ========================== */

  if (!structuredSummary || typeof structuredSummary !== "object") {
    structuredSummary = buildEmptySummary();
  }

  if (!Array.isArray(structuredSummary.mainComplaints)) {
    structuredSummary.mainComplaints = [];
  }

  if (typeof structuredSummary.historyOfPresentIllness !== "string") {
    structuredSummary.historyOfPresentIllness = "";
  }

  if (!Array.isArray(structuredSummary.objectiveFindings)) {
    structuredSummary.objectiveFindings = [];
  }

  if (
    !structuredSummary.organSystems ||
    typeof structuredSummary.organSystems !== "object"
  ) {
    structuredSummary.organSystems = {};
  }

  structuredSummary.organSystems = {
    cardiovascular: safeArray(structuredSummary.organSystems.cardiovascular),
    respiratory: safeArray(structuredSummary.organSystems.respiratory),
    nervous: safeArray(structuredSummary.organSystems.nervous),
    gastrointestinal: safeArray(
      structuredSummary.organSystems.gastrointestinal,
    ),
    genitourinary: safeArray(structuredSummary.organSystems.genitourinary),
    ent: safeArray(structuredSummary.organSystems.ent),
    other: safeArray(structuredSummary.organSystems.other),
  };

  if (!Array.isArray(structuredSummary.dynamics)) {
    structuredSummary.dynamics = [];
  }

  if (!Array.isArray(structuredSummary.riskFactors)) {
    structuredSummary.riskFactors = [];
  }

  if (!Array.isArray(structuredSummary.background)) {
    structuredSummary.background = [];
  }

  if (
    !structuredSummary.keyDiagnostics ||
    typeof structuredSummary.keyDiagnostics !== "object"
  ) {
    structuredSummary.keyDiagnostics = {};
  }

  structuredSummary.keyDiagnostics = {
    angiography: safeArray(structuredSummary.keyDiagnostics.angiography),
    labAbnormalities: safeArray(
      structuredSummary.keyDiagnostics.labAbnormalities,
    ),
    imagingSummary: safeArray(structuredSummary.keyDiagnostics.imagingSummary),
  };

  /* =========================
     ✅ LEGACY RISK ENGINE
     НЕ ЛОМАЕМ СТАРЫЙ ФРОНТ
  ========================== */

  if (
    !structuredSummary.riskAssessment ||
    typeof structuredSummary.riskAssessment !== "object"
  ) {
    structuredSummary.riskAssessment = {};
  }

  structuredSummary.riskAssessment = {
    cardiovascular: safeRiskLevel(
      structuredSummary.riskAssessment.cardiovascular,
    ),
    pulmonary: safeRiskLevel(structuredSummary.riskAssessment.pulmonary),
    neurological: safeRiskLevel(structuredSummary.riskAssessment.neurological),
    oncology: safeRiskLevel(structuredSummary.riskAssessment.oncology),
  };

  /* =========================
     ✅ PROFESSIONAL FULL RISK MAP
  ========================== */

  if (
    !structuredSummary.fullRiskAssessment ||
    typeof structuredSummary.fullRiskAssessment !== "object"
  ) {
    structuredSummary.fullRiskAssessment = {};
  }

  const normalizedFullRiskAssessment = {};

  for (const domain of RISK_DOMAINS) {
    normalizedFullRiskAssessment[domain] = normalizeRiskNode(
      structuredSummary.fullRiskAssessment[domain],
    );
  }

  structuredSummary.fullRiskAssessment = normalizedFullRiskAssessment;

  /* =========================
     ✅ PRIORITY RISKS
  ========================== */

  if (!Array.isArray(structuredSummary.priorityRisks)) {
    structuredSummary.priorityRisks = [];
  }

  structuredSummary.priorityRisks = structuredSummary.priorityRisks
    .filter((item) => item && typeof item === "object")
    .map((item) => ({
      domain:
        typeof item.domain === "string" && RISK_DOMAINS.includes(item.domain)
          ? item.domain
          : "cardiology",
      level: safeRiskLevel(item.level),
      reason: typeof item.reason === "string" ? item.reason : "",
    }))
    .filter((item) => item.reason)
    .slice(0, 3);

  /* =========================
     ✅ CLINICAL ALERTS
  ========================== */

  if (!Array.isArray(structuredSummary.clinicalAlerts)) {
    structuredSummary.clinicalAlerts = [];
  }

  structuredSummary.clinicalAlerts = structuredSummary.clinicalAlerts
    .filter((alert) => alert && typeof alert === "object")
    .map((alert) => ({
      level: safeRiskLevel(alert.level),
      title: typeof alert.title === "string" ? alert.title : "",
      message: typeof alert.message === "string" ? alert.message : "",
      source: typeof alert.source === "string" ? alert.source : "",
    }))
    .filter((alert) => alert.title || alert.message);

  if (!Array.isArray(structuredSummary.followUpRecommendations)) {
    structuredSummary.followUpRecommendations = [];
  }

  if (
    !["low", "moderate", "high"].includes(structuredSummary.clinicalSeverity)
  ) {
    structuredSummary.clinicalSeverity = "low";
  }

  if (typeof structuredSummary.aiConfidence !== "number") {
    structuredSummary.aiConfidence = 0;
  }

  /* =========================
     💾 CACHE SAVE
  ========================== */

  const patientProfile = {
    age: patientData?.age || null,

    symptoms: structuredSummary.mainComplaints || [],

    conditions: structuredSummary.background || [],

    labs: structuredSummary.keyDiagnostics?.labAbnormalities || [],

    imaging: structuredSummary.keyDiagnostics?.imagingSummary || [],
  };

  const prognosis = generatePrognosis(patientProfile);
  const explainability = generateExplainability(patientProfile);
  const completeness = calculateCompleteness(patientProfile);

  // Сначала добавляем всё в объект
  structuredSummary.prognosis = prognosis;
  structuredSummary.explainability = explainability;
  structuredSummary.meta = {
    completeness,
    confidence: structuredSummary.aiConfidence || 0,
  };

  // Только потом сохраняем в кэш — уже полный объект
  if (patientId) {
    try {
      await AISummaryCache.create({
        patientId,
        dataHash,
        summary: structuredSummary,
      });
    } catch (err) {
      console.error("AI cache save error:", err?.message || err);
    }
  }
  return structuredSummary; // ← этой строки нет в твоей версии
};
