import Anthropic from "@anthropic-ai/sdk";
import { ConsultationSession } from "./consultation.model.js";
import User from "../../common/models/Auth/users.js";

const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM = `Ты — DocPats Medical AI. 
ПРАВИЛА:
1. Отвечай ТОЛЬКО на медицинские вопросы. На всё остальное: "Я специализируюсь исключительно на медицинских вопросах."
2. Не ставь диагноз — давай "предварительную клиническую оценку".
3. Всегда рекомендуй очную консультацию врача.
4. При красных флагах (боль в груди, затруднение дыхания, признаки инсульта) — советуй звонить 103.
5. После 4-5 обменов предложи сформировать эпикриз.
6. Отвечай на языке пациента.`;

// ─── Лимиты по тарифным планам ────────────────────────────────────
const PLAN_LIMITS = {
  free: { consultations: 2, epicrises: 2, dailyMessages: 20 },
  standard: { consultations: 15, epicrises: 15, dailyMessages: 60 },
  premium: { consultations: Infinity, epicrises: Infinity, dailyMessages: 150 },
  doctor_free: { consultations: 5, epicrises: 5, dailyMessages: 30 },
  doctor_super: { consultations: 30, epicrises: 30, dailyMessages: 90 },
  doctor_pro: { consultations: 100, epicrises: 100, dailyMessages: 200 },
  clinic: { consultations: Infinity, epicrises: Infinity, dailyMessages: 500 },
  guest: { consultations: 2, epicrises: 2, dailyMessages: 10 },
};

// ─── Лимиты из .env (дефолт для гостей без плана) ─────────────────
const CONSULTATION_LIMITS = {
  guest: parseInt(process.env.CONSULTATION_GUEST_LIMIT) || 2,
  auth: parseInt(process.env.CONSULTATION_AUTH_LIMIT) || 2,
};

const EPICRISIS_LIMITS = {
  guest: parseInt(process.env.EPICRISIS_GUEST_LIMIT) || 2,
  auth: parseInt(process.env.EPICRISIS_AUTH_LIMIT) || 2,
};

// ─── Получить активный план пользователя ──────────────────────────
async function getUserPlan(userId) {
  if (!userId) return "guest";
  const user = await User.findById(userId).select(
    "subscriptionPlan subscriptionExpiresAt",
  );
  if (!user) return "free";
  const plan = user.subscriptionPlan || "free";
  const expired =
    user.subscriptionExpiresAt && user.subscriptionExpiresAt < new Date();
  return expired ? "free" : plan;
}

// ─── Получить лимиты плана (с защитой от неизвестного плана) ──────
function getLimits(plan) {
  return PLAN_LIMITS[plan] || PLAN_LIMITS.free;
}

// ─── Получить или создать запись сессии ───────────────────────────
async function getOrCreate(query) {
  let rec = await ConsultationSession.findOne(query);
  if (!rec)
    rec = await ConsultationSession.create({
      ...query,
      consultationsUsed: 0,
      epicrisesUsed: 0,
      dailyMessagesUsed: 0,
      dailyMessagesResetAt: null,
    });
  return rec;
}

// ─── Статус обоих лимитов ──────────────────────────────────────────
export async function getStatus(userId, guestId) {
  const query = userId ? { userId } : { guestId };
  const plan = await getUserPlan(userId);
  const limits = getLimits(plan);

  const maxC =
    limits.consultations === Infinity ? 999999 : limits.consultations;
  const maxE = limits.epicrises === Infinity ? 999999 : limits.epicrises;

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
    plan,
    isAuthenticated: !!userId,
    limits: {
      consultationGuest: CONSULTATION_LIMITS.guest,
      epicrisisGuest: EPICRISIS_LIMITS.guest,
    },
  };
}

// ─── Проверка лимита консультаций ─────────────────────────────────
export async function checkConsultationSession(userId, guestId) {
  const query = userId ? { userId } : { guestId };
  const plan = await getUserPlan(userId);
  const limits = getLimits(plan);
  const max = limits.consultations === Infinity ? 999999 : limits.consultations;

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
  const plan = await getUserPlan(userId);
  const limits = getLimits(plan);
  const max = limits.epicrises === Infinity ? 999999 : limits.epicrises;

  const rec = await getOrCreate(query);

  if (rec.epicrisesUsed >= max) {
    return { allowed: false, remaining: 0, max };
  }
  rec.epicrisesUsed++;
  await rec.save();
  return { allowed: true, remaining: max - rec.epicrisesUsed, max };
}

// ─── Проверка дневного лимита сообщений ───────────────────────────
export async function checkDailyMessageLimit(userId, guestId) {
  const query = userId ? { userId } : { guestId };
  const plan = await getUserPlan(userId);
  const limits = getLimits(plan);
  const limit = limits.dailyMessages;

  const rec = await getOrCreate(query);

  // Сбрасываем счётчик если прошли сутки
  const now = new Date();
  const lastReset = rec.dailyMessagesResetAt || new Date(0);
  const hoursSinceReset = (now - lastReset) / (1000 * 60 * 60);

  if (hoursSinceReset >= 24) {
    rec.dailyMessagesUsed = 0;
    rec.dailyMessagesResetAt = now;
  }

  if (rec.dailyMessagesUsed >= limit) {
    return {
      allowed: false,
      remaining: 0,
      limit,
      resetsAt: rec.dailyMessagesResetAt,
    };
  }

  rec.dailyMessagesUsed += 1;
  await rec.save();

  return {
    allowed: true,
    remaining: limit - rec.dailyMessagesUsed,
    limit,
  };
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
