import Anthropic from "@anthropic-ai/sdk";
import mongoose from "mongoose";
import { ConsultationSession } from "./consultation.model.js";
import User from "../../common/models/Auth/users.js";
import {
  resolveEffectivePlan,
  getLimit,
} from "../../common/config/aiPlanLimits.js";

const claude = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  timeout: 60_000,
});

const SYSTEM = `Ты — DocPats Medical AI. 
ПРАВИЛА:
1. Отвечай ТОЛЬКО на медицинские вопросы. На всё остальное: "Я специализируюсь исключительно на медицинских вопросах."
2. Не ставь диагноз — давай "предварительную клиническую оценку".
3. Всегда рекомендуй очную консультацию врача.
4. При красных флагах (боль в груди, затруднение дыхания, признаки инсульта) — советуй звонить 103.
5. После 4-5 обменов предложи сформировать эпикриз.
6. Отвечай на языке пациента.`;

const CHAT_MODEL = process.env.AI_CHAT_MODEL || "claude-haiku-4-5-20251001";
const EPICRISIS_MODEL = process.env.AI_EPICRISIS_MODEL || "claude-sonnet-4-6";

// ─── Лимиты из .env ───────────────────────────────────────────────
const CONSULTATION_LIMITS = {
  guest: parseInt(process.env.CONSULTATION_GUEST_LIMIT) || 3,
  auth: parseInt(process.env.CONSULTATION_AUTH_LIMIT) || 50,
};

const EPICRISIS_LIMITS = {
  guest: parseInt(process.env.EPICRISIS_GUEST_LIMIT) || 1,
  auth: parseInt(process.env.EPICRISIS_AUTH_LIMIT) || 10,
};

// ─── Утилиты ───────────────────────────────────────────────────────
function toObjectId(id) {
  if (!id) return null;
  try {
    return new mongoose.Types.ObjectId(String(id));
  } catch {
    return null;
  }
}

function buildQuery(userId, guestId) {
  const oid = toObjectId(userId);
  return {
    query: oid ? { userId: oid } : { guestId },
    isAuth: !!oid,
  };
}

function getMaxes(isAuth) {
  return {
    consultations: isAuth
      ? CONSULTATION_LIMITS.auth
      : CONSULTATION_LIMITS.guest,
    epicrises: isAuth ? EPICRISIS_LIMITS.auth : EPICRISIS_LIMITS.guest,
  };
}

// Максимум консультаций: тариф + бонусы за рефералов (bonusConsultations).
//
// РАНЬШЕ ТАРИФ НЕ УЧИТЫВАЛСЯ ВОВСЕ. Предел брался из константы модуля
// (CONSULTATION_LIMITS.auth = 50), одинаковой для всех авторизованных, а
// страница тарифов при этом продавала «10 консультаций на Plus» и «25 на
// Pro». То есть бесплатный пациент получал ровно столько же, сколько
// платящий, а числа в прайсе не читала ни одна строка кода — ровно как с
// комиссией и месячными квотами разборов.
//
// Теперь предел берётся из плана. Константа модуля осталась запасным
// значением: план может не описывать фичу (служебные роли, админ), и
// падать в ноль там, где раньше работало, — хуже, чем отдать прежние 50.
//
// Для гостей бонусов нет. Ошибку чтения User трактуем как «без бонуса».
async function consultationMaxFor(userId, isAuth) {
  if (!isAuth || !userId) return CONSULTATION_LIMITS.guest;

  let user = null;
  try {
    user = await User.findById(userId)
      .select("role subscriptionPlan trialEndsAt bonusConsultations")
      .lean();
  } catch {
    /* сеть/база недоступны — работаем по запасному значению */
  }

  const planLimit = user ? getLimit(resolveEffectivePlan(user), "aiConsultations") : 0;
  // -1 = безлимит; 0 = фича у плана не описана → запасное значение модуля.
  let max =
    planLimit === -1
      ? Number.MAX_SAFE_INTEGER
      : planLimit > 0
        ? planLimit
        : CONSULTATION_LIMITS.auth;

  if (user?.bonusConsultations && max !== Number.MAX_SAFE_INTEGER) {
    max += user.bonusConsultations;
  }
  return max;
}

// ─── Статус обоих лимитов ──────────────────────────────────────────
export async function getStatus(userId, guestId) {
  const { query, isAuth } = buildQuery(userId, guestId);
  const max = getMaxes(isAuth);
  const consMax = await consultationMaxFor(userId, isAuth);
  const rec = await ConsultationSession.findOne(query).lean();

  const consUsed = rec?.consultationsUsed || 0;
  const epicUsed = rec?.epicrisesUsed || 0;

  return {
    isAuthenticated: isAuth,
    consultations: {
      used: consUsed,
      remaining: Math.max(0, consMax - consUsed),
      max: consMax,
    },
    epicrises: {
      used: epicUsed,
      remaining: Math.max(0, max.epicrises - epicUsed),
      max: max.epicrises,
    },
    limits: {
      consultationGuest: CONSULTATION_LIMITS.guest,
      epicrisisGuest: EPICRISIS_LIMITS.guest,
    },
  };
}

// ─── КОНСУЛЬТАЦИИ ──────────────────────────────────────────────────

// Проверка лимита БЕЗ инкремента
export async function checkConsultationLimit(userId, guestId) {
  const { query, isAuth } = buildQuery(userId, guestId);
  const max = await consultationMaxFor(userId, isAuth);
  const rec = await ConsultationSession.findOne(query).lean();
  const used = rec?.consultationsUsed || 0;
  return {
    allowed: used < max,
    used,
    remaining: Math.max(0, max - used),
    max,
  };
}

// Атомарный инкремент ПОСЛЕ успешного ответа Claude
export async function consumeConsultation(userId, guestId) {
  const { query, isAuth } = buildQuery(userId, guestId);
  const max = await consultationMaxFor(userId, isAuth);

  const rec = await ConsultationSession.findOneAndUpdate(
    query,
    { $inc: { consultationsUsed: 1 }, $setOnInsert: { ...query } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );

  return {
    used: rec.consultationsUsed,
    remaining: Math.max(0, max - rec.consultationsUsed),
    max,
  };
}

// ─── ЭПИКРИЗЫ ──────────────────────────────────────────────────────

// Проверка лимита БЕЗ инкремента
export async function checkEpicrisisLimit(userId, guestId) {
  const { query, isAuth } = buildQuery(userId, guestId);
  const max = getMaxes(isAuth).epicrises;
  const rec = await ConsultationSession.findOne(query).lean();
  const used = rec?.epicrisesUsed || 0;
  return {
    allowed: used < max,
    used,
    remaining: Math.max(0, max - used),
    max,
  };
}

// Атомарный инкремент ПОСЛЕ успешной генерации эпикриза
export async function consumeEpicrisis(userId, guestId) {
  const { query, isAuth } = buildQuery(userId, guestId);
  const max = getMaxes(isAuth).epicrises;

  const rec = await ConsultationSession.findOneAndUpdate(
    query,
    { $inc: { epicrisesUsed: 1 }, $setOnInsert: { ...query } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );

  return {
    used: rec.epicrisesUsed,
    remaining: Math.max(0, max - rec.epicrisesUsed),
    max,
  };
}

// Совместимость со старым API (если где-то ещё вызывается)
export async function checkEpicrisisSession(userId, guestId) {
  const limit = await checkEpicrisisLimit(userId, guestId);
  if (!limit.allowed) return { allowed: false, remaining: 0, max: limit.max };
  const consumed = await consumeEpicrisis(userId, guestId);
  return { allowed: true, ...consumed };
}

// ─── Чат с Claude ─────────────────────────────────────────────────
export async function chatWithClaude(messages, patientInfo) {
  const system = `${SYSTEM}\n\nПациент: ${patientInfo.name || "Пациент"}, ${patientInfo.age || "—"} лет, ${patientInfo.gender || "—"}.`;

  const res = await claude.messages.create({
    model: CHAT_MODEL,
    max_tokens: 1000,
    system,
    messages,
  });

  const text = res?.content?.[0]?.text;
  if (!text) {
    console.error("[chatWithClaude] empty response:", JSON.stringify(res));
    throw new Error("AI вернул пустой ответ");
  }
  return text;
}

// ─── Генерация эпикриза ───────────────────────────────────────────
export async function buildEpicrisis(messages, patientInfo) {
  const convo = messages
    .map((m) => `${m.role === "user" ? "Пациент" : "ИИ"}: ${m.content}`)
    .join("\n\n");

  const res = await claude.messages.create({
    model: EPICRISIS_MODEL,
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

  const rawText = res?.content?.[0]?.text;
  if (!rawText) {
    console.error("[buildEpicrisis] empty AI response");
    throw new Error("AI вернул пустой ответ");
  }

  const cleaned = rawText
    .trim()
    .replace(/```json?|```/g, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch (err) {
    console.error("[buildEpicrisis] invalid JSON from Claude:", cleaned);
    throw new Error("AI вернул невалидный JSON для эпикриза");
  }
}
