import {
  checkConsultationSession,
  checkEpicrisisSession,
  checkDailyMessageLimit,
  getStatus,
  chatWithClaude,
  buildEpicrisis,
} from "./consultation.service.js";
import User from "../../common/models/Auth/users.js";

// ─── GET /api/consultation/session-status ─────────────────────────
export async function sessionStatus(req, res) {
  try {
    const userId = req.session?.userId || null;
    const guestId = req.headers["x-guest-id"] || req.ip;
    res.json(await getStatus(userId, guestId));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// ─── POST /api/consultation/start ─────────────────────────────────
// Проверяет лимит по тарифному плану и увеличивает счётчик.
// Блокирует 429 если лимит исчерпан.
export async function startSession(req, res) {
  try {
    const userId = req.session?.userId || null;
    const guestId = req.headers["x-guest-id"] || req.ip;

    const result = await checkConsultationSession(userId, guestId);
    if (!result.allowed) {
      return res.status(429).json({ error: "SESSION_LIMIT", ...result });
    }

    res.json({ ok: true, remaining: result.remaining, max: result.max });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// ─── POST /api/consultation/message ───────────────────────────────
// Проверяет:
// 1. Что сессия была открыта через /start
// 2. Дневной лимит сообщений по тарифному плану
export async function chat(req, res) {
  try {
    const userId = req.session?.userId || null;
    const guestId = req.headers["x-guest-id"] || req.ip;

    const status = await getStatus(userId, guestId);

    // Если пользователь вообще не открывал сессию через /start — отказываем
    if (status.consultations.used === 0) {
      return res.status(403).json({ error: "NO_ACTIVE_SESSION" });
    }

    // Проверяем дневной лимит сообщений
    const msgLimit = await checkDailyMessageLimit(userId, guestId);
    if (!msgLimit.allowed) {
      return res.status(429).json({
        error: "DAILY_MESSAGE_LIMIT",
        message: "Дневной лимит сообщений исчерпан",
        resetsAt: msgLimit.resetsAt,
      });
    }

    const { messages, patientInfo } = req.body;
    if (!messages?.length) {
      return res.status(400).json({ error: "messages required" });
    }

    const reply = await chatWithClaude(messages, patientInfo || {});
    res.json({ reply, dailyRemaining: msgLimit.remaining });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// ─── POST /api/consultation/epicrisis ─────────────────────────────
export async function epicrisis(req, res) {
  try {
    const userId = req.session?.userId || null;
    const guestId = req.headers["x-guest-id"] || req.ip;

    const limitResult = await checkEpicrisisSession(userId, guestId);
    if (!limitResult.allowed) {
      return res.status(429).json({ error: "SESSION_LIMIT", ...limitResult });
    }

    const { messages, patientInfo } = req.body;
    const data = await buildEpicrisis(messages, patientInfo);

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

    res.json({ epicrisis: data, doctors });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
