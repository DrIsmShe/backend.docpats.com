import {
  checkConsultationSession,
  checkEpicrisisSession,
  getStatus,
  chatWithClaude,
  buildEpicrisis,
} from "./consultation.service.js";
import User from "../../common/models/Auth/users.js";

export async function sessionStatus(req, res) {
  try {
    const userId = req.session?.userId || null;
    const guestId = req.headers["x-guest-id"] || req.ip;
    res.json(await getStatus(userId, guestId));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

export async function startSession(req, res) {
  try {
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

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

export async function chat(req, res) {
  try {
    const { messages, patientInfo } = req.body;
    if (!messages?.length)
      return res.status(400).json({ error: "messages required" });
    const reply = await chatWithClaude(messages, patientInfo || {});
    res.json({ reply });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
