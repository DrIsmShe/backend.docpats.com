import Anthropic from "@anthropic-ai/sdk";
import { ConsultationSession } from "./consultation.model.js";

const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM = `Ты — DocPats Medical AI. 
ПРАВИЛА:
1. Отвечай ТОЛЬКО на медицинские вопросы. На всё остальное: "Я специализируюсь исключительно на медицинских вопросах."
2. Не ставь диагноз — давай "предварительную клиническую оценку".
3. Всегда рекомендуй очную консультацию врача.
4. При красных флагах (боль в груди, затруднение дыхания, признаки инсульта) — советуй звонить 103.
5. После 4-5 обменов предложи сформировать эпикриз.
6. Отвечай на языке пациента.`;

// ─── Лимиты из .env ───────────────────────────────────────────────
const CONSULTATION_LIMITS = {
  guest: parseInt(process.env.CONSULTATION_GUEST_LIMIT) || 100,
  auth: parseInt(process.env.CONSULTATION_AUTH_LIMIT) || 500,
};

const EPICRISIS_LIMITS = {
  guest: parseInt(process.env.EPICRISIS_GUEST_LIMIT) || 1,
  auth: parseInt(process.env.EPICRISIS_AUTH_LIMIT) || 3,
};

// ─── Получить или создать запись ───────────────────────────────────
async function getOrCreate(query) {
  let rec = await ConsultationSession.findOne(query);
  if (!rec)
    rec = await ConsultationSession.create({
      ...query,
      consultationsUsed: 0,
      epicrisesUsed: 0,
    });
  return rec;
}

// ─── Статус обоих лимитов ──────────────────────────────────────────
export async function getStatus(userId, guestId) {
  const query = userId ? { userId } : { guestId };
  const maxC = userId ? CONSULTATION_LIMITS.auth : CONSULTATION_LIMITS.guest;
  const maxE = userId ? EPICRISIS_LIMITS.auth : EPICRISIS_LIMITS.guest;
  const rec = await ConsultationSession.findOne(query);

  return {
    consultations: {
      used: rec?.consultationsUsed || 0,
      remaining: Math.max(0, maxC - (rec?.consultationsUsed || 0)),
      max: maxC,
    },
    epicrises: {
      used: rec?.epicrisesUsed || 0,
      remaining: Math.max(0, maxE - (rec?.epicrisesUsed || 0)),
      max: maxE,
    },
    // Передаём лимиты на фронт чтобы использовать как дефолт
    limits: {
      consultationGuest: CONSULTATION_LIMITS.guest,
      epicrisisGuest: EPICRISIS_LIMITS.guest,
    },
  };
}

// ─── Проверка лимита консультаций ─────────────────────────────────
export async function checkConsultationSession(userId, guestId) {
  const query = userId ? { userId } : { guestId };
  const max = userId ? CONSULTATION_LIMITS.auth : CONSULTATION_LIMITS.guest;
  const rec = await getOrCreate(query);

  if (rec.consultationsUsed >= max) {
    return { allowed: false, remaining: 0, max };
  }
  rec.consultationsUsed++;
  await rec.save();
  return { allowed: true, remaining: max - rec.consultationsUsed, max };
}

// ─── Проверка лимита эпикризов ────────────────────────────────────
export async function checkEpicrisisSession(userId, guestId) {
  const query = userId ? { userId } : { guestId };
  const max = userId ? EPICRISIS_LIMITS.auth : EPICRISIS_LIMITS.guest;
  const rec = await getOrCreate(query);

  if (rec.epicrisesUsed >= max) {
    return { allowed: false, remaining: 0, max };
  }
  rec.epicrisesUsed++;
  await rec.save();
  return { allowed: true, remaining: max - rec.epicrisesUsed, max };
}

// ─── Чат с Claude ─────────────────────────────────────────────────
export async function chatWithClaude(messages, patientInfo) {
  const system = `${SYSTEM}\n\nПациент: ${patientInfo.name || "Пациент"}, ${patientInfo.age || "—"} лет, ${patientInfo.gender || "—"}.`;
  const res = await claude.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1000,
    system,
    messages,
  });
  return res.content[0].text;
}

// ─── Генерация эпикриза ───────────────────────────────────────────
export async function buildEpicrisis(messages, patientInfo) {
  const convo = messages
    .map((m) => `${m.role === "user" ? "Пациент" : "ИИ"}: ${m.content}`)
    .join("\n\n");

  const res = await claude.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 1500,
    system: "Медицинский ИИ. Верни ТОЛЬКО валидный JSON без markdown.",
    messages: [
      {
        role: "user",
        content: `Пациент: ${patientInfo.name}, ${patientInfo.age} лет, ${patientInfo.gender}.
Диалог:\n${convo}

Верни JSON:
{
  "chiefComplaint": "",
  "historyOfPresentIllness": "",
  "systemsReview": "",
  "preliminaryAssessment": "",
  "differentialDiagnoses": ["", ""],
  "recommendations": ["", "", ""],
  "additionalTests": ["", ""],
  "lifestyleAdvice": "",
  "urgencyLevel": "routine",
  "specialistsNeeded": ["", ""]
}`,
      },
    ],
  });

  const raw = res.content[0].text
    .trim()
    .replace(/```json?|```/g, "")
    .trim();
  return JSON.parse(raw);
}
