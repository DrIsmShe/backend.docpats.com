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

// Роли, у которых тариф описывает консультации отдельным полем.
// Совпадает с тем, как роль трактует resolveEffectivePlan: врачебные
// планы там выдаются только роли doctor.
const DOCTOR_ROLES = ["doctor"];

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

// getMaxes() убрана: оба предела теперь резолвятся из тарифа
// (consultationMaxFor / epicrisisMaxFor), а константы модуля остались у них
// запасным значением. Держать рядом функцию, отдающую те же числа мимо
// тарифа, — верный способ однажды позвать не ту.

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
      .select("role subscriptionPlan subscriptionEndsAt trialEndsAt bonusConsultations")
      .lean();
  } catch {
    /* сеть/база недоступны — работаем по запасному значению */
  }

  // У врача и у пациента это РАЗНЫЕ поля тарифа, и путать их нельзя.
  //
  // Пациент консультируется о себе — aiConsultations. Врач запускает
  // консультацию о своём пациенте — aiPatientConsultations, и в прайсе
  // это отдельная строка («3 / 8 / 30 / 60 AI-консультаций пациентов»).
  //
  // Врачебные планы поля aiConsultations не описывают вовсе, поэтому
  // раньше здесь получался 0 → запасные 7 из .env. Врач на Pro, которому
  // продали 60 консультаций, получал 7; врач на Lite, которому продали 3,
  // получал те же 7. Ошибались в обе стороны сразу.
  const field = DOCTOR_ROLES.includes(user?.role)
    ? "aiPatientConsultations"
    : "aiConsultations";
  const planLimit = user ? getLimit(resolveEffectivePlan(user), field) : 0;
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

/**
 * Максимум эпикризов: тариф, если он эту фичу описывает.
 *
 * У пациентских планов soapEpicrises НЕТ намеренно — эпикриз убран из
 * пациентских тарифов как клинический документ, который человек делает
 * сам себе без врача. Но саму функцию мы не гасили: она работает у живых
 * пользователей, и отключать её посреди дня — не правка прайса. Поэтому
 * здесь запасное значение модуля, а не отказ.
 *
 * Врачебные и клинические планы фичу описывают (5–100 в месяц), и когда
 * генератор эпикризов для врача появится, предел заработает сам — считать
 * он будет по той же сессии.
 */
async function epicrisisMaxFor(userId, isAuth) {
  if (!isAuth || !userId) return EPICRISIS_LIMITS.guest;

  let user = null;
  try {
    user = await User.findById(userId)
      .select("role subscriptionPlan subscriptionEndsAt trialEndsAt")
      .lean();
  } catch {
    /* база недоступна — работаем по запасному значению */
  }

  const planLimit = user ? getLimit(resolveEffectivePlan(user), "soapEpicrises") : 0;
  if (planLimit === -1) return Number.MAX_SAFE_INTEGER;
  return planLimit > 0 ? planLimit : EPICRISIS_LIMITS.auth;
}

// ─── Статус обоих лимитов ──────────────────────────────────────────
export async function getStatus(userId, guestId) {
  const { query, isAuth } = buildQuery(userId, guestId);
  const consMax = await consultationMaxFor(userId, isAuth);
  const epicMax = await epicrisisMaxFor(userId, isAuth);
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
      remaining: Math.max(0, epicMax - epicUsed),
      max: epicMax,
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
  const max = await epicrisisMaxFor(userId, isAuth);
  const rec = await ConsultationSession.findOne(query).lean();
  const used = rec?.epicrisesUsed || 0;
  return {
    allowed: used < max,
    used,
    remaining: Math.max(0, max - used),
    max,
  };
}

/**
 * Занять место ДО обращения к модели — атомарно.
 *
 * Почему не «проверить, потом списать»: между двумя запросами к базе
 * помещается второй запрос пользователя, и при остатке в одну штуку
 * пройдут оба. Условие `$lt: max` в самом фильтре делает проверку и
 * списание одной операцией, которую база не разрывает.
 *
 * Возвращает null, если места нет.
 */
async function reserve(query, field, max) {
  if (max <= 0) return null;

  // Два шага, и оба обязательны.
  //
  // Соблазн сделать это одним findOneAndUpdate с upsert и условием
  // `$lt: max` в фильтре — ловушка: когда лимит исчерпан, фильтр не
  // совпадает, и upsert не отказывает, а СОЗДАЁТ вторую запись со
  // счётчиком 1. Лимит при этом перестаёт существовать вовсе.
  //
  // Поэтому сначала гарантируем наличие записи (upsert без условия),
  // и только потом делаем условный инкремент БЕЗ upsert — вот он уже
  // честно возвращает null, когда места нет.
  await ConsultationSession.updateOne(
    query,
    { $setOnInsert: { ...query } },
    { upsert: true, setDefaultsOnInsert: true },
  ).catch((e) => {
    // Гонка двух первых запросов: запись создал сосед — это и требовалось.
    if (e?.code !== 11000) throw e;
  });

  const rec = await ConsultationSession.findOneAndUpdate(
    { ...query, [field]: { $lt: max } },
    { $inc: { [field]: 1 } },
    { new: true },
  );

  if (!rec) return null;
  return {
    used: rec[field],
    remaining: Math.max(0, max - rec[field]),
    max,
  };
}

/** Вернуть занятое место: модель не ответила, платить человеку не за что. */
async function release(query, field) {
  await ConsultationSession.updateOne(
    { ...query, [field]: { $gt: 0 } },
    { $inc: { [field]: -1 } },
  ).catch((e) => {
    // Возврат не критичен настолько, чтобы ронять ответ пользователю:
    // хуже потерять одну единицу, чем показать ошибку поверх ошибки.
    console.error(`consultation: возврат ${field} не удался — ${e.message}`);
  });
}

/**
 * Занять консультацию ДО обращения к модели.
 * Возвращает null, если лимит исчерпан.
 */
export async function reserveConsultation(userId, guestId) {
  const { query, isAuth } = buildQuery(userId, guestId);
  const max = await consultationMaxFor(userId, isAuth);
  return reserve(query, "consultationsUsed", max);
}

/** Вернуть консультацию, если модель не ответила. */
export async function releaseConsultation(userId, guestId) {
  const { query } = buildQuery(userId, guestId);
  return release(query, "consultationsUsed");
}

/**
 * Занять эпикриз ДО обращения к модели.
 *
 * Раньше проверка стояла ПОСЛЕ генерации: человек сверх лимита ничего не
 * получал, но каждый его запрос всё равно уходил в модель и стоил денег.
 * Отказ, за который мы платим, — худший вид отказа.
 */
export async function reserveEpicrisis(userId, guestId) {
  const { query, isAuth } = buildQuery(userId, guestId);
  const max = await epicrisisMaxFor(userId, isAuth);
  return reserve(query, "epicrisesUsed", max);
}

/** Вернуть эпикриз, если модель не ответила. */
export async function releaseEpicrisis(userId, guestId) {
  const { query } = buildQuery(userId, guestId);
  return release(query, "epicrisesUsed");
}

// Атомарный инкремент ПОСЛЕ успешной генерации эпикриза
export async function consumeEpicrisis(userId, guestId) {
  const { query, isAuth } = buildQuery(userId, guestId);
  const max = await epicrisisMaxFor(userId, isAuth);

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
