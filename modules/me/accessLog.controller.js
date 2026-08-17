// server/modules/me/accessLog.controller.js
//
// GET /api/me/access-log — «кто открывал мою карту».
//
// Пациент видит журнал доступа к СВОИМ данным. Чужой журнал получить
// нельзя: идентификатор берётся из сессии, параметра в запросе нет
// вовсе — там, где нет параметра, нечего подделывать.

import { getPatientAccessLog } from "../audit/services/patientAccessLog.service.js";

export async function getMyAccessLog(req, res) {
  try {
    const items = await getPatientAccessLog({
      userId: req.session.userId,
      limit: Number(req.query.limit) || 100,
      includeOwn: req.query.includeOwn === "1",
    });

    return res.json({ success: true, items, count: items.length });
  } catch (err) {
    console.error("accessLog:", err);
    return res
      .status(500)
      .json({ success: false, message: "Не удалось загрузить журнал доступа" });
  }
}

export default { getMyAccessLog };
