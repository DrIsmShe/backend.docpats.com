import {
  checkConsultationSession,
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
    // isAuthenticated уже включён в data из getStatus()
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// ─── POST /api/consultation/start ─────────────────────────────────
export async function startSession(req, res) {
  try {
    const userId = extractUserId(req);
    const guestId = extractGuestId(req);

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
export async function chat(req, res) {
  try {
    const userId = extractUserId(req);
    const guestId = extractGuestId(req);

    const status = await getStatus(userId, guestId);

    if (status.consultations.used === 0) {
      return res.status(403).json({ error: "NO_ACTIVE_SESSION" });
    }

    if (status.consultations.remaining <= 0) {
      return res.status(429).json({ error: "SESSION_LIMIT" });
    }

    const { messages, patientInfo } = req.body;
    if (!messages?.length) {
      return res.status(400).json({ error: "messages required" });
    }

    const reply = await chatWithClaude(messages, patientInfo || {});
    res.json({ reply });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

// ─── POST /api/consultation/epicrisis ─────────────────────────────
export async function epicrisis(req, res) {
  try {
    const userId = extractUserId(req);
    const guestId = extractGuestId(req);

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
