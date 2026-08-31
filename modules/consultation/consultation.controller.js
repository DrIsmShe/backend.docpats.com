import {
  checkConsultationLimit,
  reserveConsultation,
  releaseConsultation,
  checkEpicrisisLimit,
  reserveEpicrisis,
  releaseEpicrisis,
  getStatus,
  chatWithClaude,
  buildEpicrisis,
} from "./consultation.service.js";
import User from "../../common/models/Auth/users.js";
import { errorText } from "../../common/i18n/index.js";

// ─── Извлечь userId из сессии (всегда строка или null) ────────────
function extractUserId(req) {
  return req.session?.userId ? String(req.session.userId) : null;
}

function extractGuestId(req) {
  return req.headers["x-guest-id"] || req.ip;
}

// ─── GET /api/consultation/session-status ─────────────────────────
export async function sessionStatus(req, res) {
  try {
    const userId = extractUserId(req);
    const guestId = extractGuestId(req);
    const data = await getStatus(userId, guestId);
    res.json(data);
  } catch (e) {
    console.error("[sessionStatus] error:", e);
    res.status(500).json({ error: errorText(e, req) });
  }
}

// ─── POST /api/consultation/start ─────────────────────────────────
// Только проверка лимита, БЕЗ инкремента.
// Инкремент произойдёт в /message после успешного ответа Claude.
export async function startSession(req, res) {
  try {
    const userId = extractUserId(req);
    const guestId = extractGuestId(req);

    const result = await checkConsultationLimit(userId, guestId);
    if (!result.allowed) {
      return res.status(429).json({ error: "SESSION_LIMIT", ...result });
    }

    res.json({ ok: true, remaining: result.remaining, max: result.max });
  } catch (e) {
    console.error("[startSession] error:", e);
    res.status(500).json({ error: errorText(e, req) });
  }
}

// ─── POST /api/consultation/message ───────────────────────────────
// Первое сообщение в массиве = greeting, и только тогда списывается
// одна консультация — после успешного ответа Claude.
export async function chat(req, res) {
  try {
    const userId = extractUserId(req);
    const guestId = extractGuestId(req);
    const { messages, patientInfo, isGreeting } = req.body;

    if (!messages?.length) {
      return res.status(400).json({ error: "messages required" });
    }

    // Начало консультации определяет СЕРВЕР, а не браузер.
    //
    // Раньше списание зависело только от флага isGreeting в теле запроса.
    // Клиент, который его не присылает, консультировался бесконечно —
    // лимит существовал ровно до первого человека, открывшего вкладку
    // разработчика.
    //
    // Признак сервера: в переписке ещё нет ни одного ответа модели. Его
    // нельзя обойти в свою пользу — вырезав историю, человек получит не
    // бесплатную консультацию, а новую, то есть спишется больше.
    // Флаг клиента оставляем как второй сигнал: он не может отменить
    // списание, только добавить.
    const hasAssistantTurn = messages.some(
      (m) => m?.role === "assistant" || m?.role === "model",
    );
    const startsSession = !hasAssistantTurn || Boolean(isGreeting);

    // Место занимаем ДО обращения к модели: иначе два одновременных
    // запроса при остатке в одну консультацию проходят оба.
    let counter = null;
    if (startsSession) {
      counter = await reserveConsultation(userId, guestId);
      if (!counter) {
        const state = await checkConsultationLimit(userId, guestId);
        return res.status(429).json({ error: "SESSION_LIMIT", ...state });
      }
    }

    let reply;
    try {
      reply = await chatWithClaude(messages, patientInfo || {});
    } catch (aiErr) {
      // Модель не ответила — консультацию не засчитываем.
      if (counter) await releaseConsultation(userId, guestId);
      throw aiErr;
    }

    res.json({
      reply,
      ...(counter && {
        remaining: counter.remaining,
        max: counter.max,
        used: counter.used,
      }),
    });
  } catch (e) {
    console.error("[chat] error:", e);
    res.status(500).json({ error: errorText(e, req) || "Chat error" });
  }
}

// ─── POST /api/consultation/epicrisis ─────────────────────────────
export async function epicrisis(req, res) {
  try {
    const userId = extractUserId(req);
    const guestId = extractGuestId(req);
    const { messages, patientInfo } = req.body;

    if (!messages?.length) {
      return res.status(400).json({ error: "messages required" });
    }

    // Место занимаем ДО обращения к модели.
    //
    // Раньше эпикриз сначала генерировался, и только потом смотрелся
    // лимит: человек сверх предела ничего не получал, но каждый его
    // запрос уходил в модель и стоил нам денег. Отказ, за который мы
    // платим, — худший вид отказа, и повторять его можно бесконечно.
    const limitResult = await reserveEpicrisis(userId, guestId);
    if (!limitResult) {
      const state = await checkEpicrisisLimit(userId, guestId);
      return res.status(429).json({ error: "SESSION_LIMIT", ...state });
    }

    let data;
    try {
      data = await buildEpicrisis(messages, patientInfo || {});
    } catch (aiErr) {
      // Модель не ответила — возвращаем место: человек ничего не получил.
      await releaseEpicrisis(userId, guestId);
      console.error("[epicrisis] AI generation failed:", aiErr);
      return res.status(500).json({ error: "EPICRISIS_GENERATION_FAILED" });
    }

    // Подбор врачей
    const doctors = await User.find({
      role: "doctor",
      isVerified: true,
      specialty: {
        $in: (data.specialistsNeeded || []).map((s) => new RegExp(s, "i")),
      },
    })
      .select(
        "firstName lastName specialty title rating experience consultationPrice availableSlots avatarColor",
      )
      .limit(3)
      .lean();

    res.json({
      epicrisis: data,
      doctors,
      epicrisesRemaining: limitResult.remaining,
      epicrisesMax: limitResult.max,
    });
  } catch (e) {
    console.error("[epicrisis] error:", e);
    res.status(500).json({ error: errorText(e, req) || "Epicrisis error" });
  }
}
