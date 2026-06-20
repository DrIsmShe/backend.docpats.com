// server/modules/patientAppointments/controllers/patientConsiliumList.controller.js
//
// GET the consilia the current patient may join (invited via patientCanJoin).
// Session-authenticated (authMiddleware sets req.userId). No tenant context.

import { getMyJoinableConsilia } from "../services/patientConsiliumList.service.js";

export const getMyConsiliaController = async (req, res) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res
        .status(401)
        .json({ success: false, message: "Неавторизованный доступ" });
    }

    const items = await getMyJoinableConsilia(userId);
    return res.status(200).json({ success: true, items });
  } catch (err) {
    return res
      .status(500)
      .json({ success: false, message: err?.message || "Ошибка сервера" });
  }
};

export default { getMyConsiliaController };
