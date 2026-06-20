// server/modules/patientAppointments/controllers/patientTelemedList.controller.js
//
// Returns the telemed sessions the current patient may attend. Session auth
// (authMiddleware → req.userId). No clinic membership required.

import { listPatientTelemedSessions } from "../services/patientTelemedList.service.js";

export const listPatientTelemedSessionsController = async (req, res) => {
  try {
    const userId = req.userId;
    if (!userId) {
      return res
        .status(401)
        .json({ success: false, message: "Неавторизованный доступ" });
    }

    const data = await listPatientTelemedSessions({ userId });
    return res.status(200).json({ success: true, data });
  } catch (err) {
    console.error("patientTelemedList error:", err?.message);
    return res.status(500).json({ success: false, message: "Ошибка сервера" });
  }
};

export default { listPatientTelemedSessionsController };
