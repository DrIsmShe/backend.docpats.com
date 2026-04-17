import {
  checkConsultationLimit,
  consumeConsultation,
  checkEpicrisisSession,
  getStatus,
  chatWithClaude,
  buildEpicrisis,
} from "./consultation.service.js";
import User from "../../common/models/Auth/users.js";

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
    res.status(500).json({ error: e.message });
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
    res.status(500).json({ error: e.message });
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

    // Полагаемся на явный флаг от клиента — надёжнее, чем messages.length === 1
    if (isGreeting) {
      const limit = await checkConsultationLimit(userId, guestId);
      if (!limit.allowed) {
        return res.status(429).json({ error: "SESSION_LIMIT", ...limit });
      }
    }

    // Если Claude упадёт — вылетит в catch, счётчик НЕ тронется
    const reply = await chatWithClaude(messages, patientInfo || {});

    // Списываем консультацию ТОЛЬКО после успешного ответа Claude
    let counter = null;
    if (isGreeting) {
      counter = await consumeConsultation(userId, guestId);
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
    res.status(500).json({ error: e.message || "Chat error" });
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

    // Сначала генерируем эпикриз — если AI упадёт, счётчик не сдвинется
    let data;
    try {
      data = await buildEpicrisis(messages, patientInfo || {});
    } catch (aiErr) {
      console.error("[epicrisis] AI generation failed:", aiErr);
      return res.status(500).json({ error: "EPICRISIS_GENERATION_FAILED" });
    }

    // Только после успешной генерации — проверка и инкремент лимита
    const limitResult = await checkEpicrisisSession(userId, guestId);
    if (!limitResult.allowed) {
      return res.status(429).json({ error: "SESSION_LIMIT", ...limitResult });
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
    res.status(500).json({ error: e.message || "Epicrisis error" });
  }
}
