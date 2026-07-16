// server/modules/presence/index.js
//
// Presence-heartbeat. Фронт (users-list и др.) шлёт POST /presence/heartbeat
// раз в минуту, чтобы держать пользователя online. Это HTTP-fallback к
// основному presence на сокете (socket.gateway.js): если сокет не поднялся,
// список пользователей всё равно покажет активного юзера онлайн.
//
// Статус в списке считается по User.lastActive (окно 2 мин), поэтому здесь
// достаточно освежать lastActive. «invisible» не раскрываем.

import { Router } from "express";
import User from "../../common/models/Auth/users.js";

const router = Router();

router.post("/heartbeat", async (req, res) => {
  const userId = req.session?.userId;
  if (!userId) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    await User.updateOne(
      { _id: userId, status: { $ne: "invisible" } },
      { $set: { status: "online", lastActive: new Date() } },
    );
    await User.updateOne(
      { _id: userId, status: "invisible" },
      { $set: { lastActive: new Date() } },
    );
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.warn("[presence] heartbeat failed:", e.message);
    return res.status(500).json({ message: "Presence update failed" });
  }
});

export default router;
