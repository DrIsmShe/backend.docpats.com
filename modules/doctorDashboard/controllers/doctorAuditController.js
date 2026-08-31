import mongoose from "mongoose";
import AppointmentAudit from "../../../common/models/Appointment/appointmentAudit.js";
import { tReq } from "../../../common/i18n/index.js";

export const getAppointmentAudit = async (req, res) => {
  try {
    const { id } = req.params;

    // 🔹 Проверяем корректность id
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res
        .status(400)
        .json({ success: false, message: tReq(req, "app.appointment.invalidId") });
    }

    // 🔹 Приводим к ObjectId
    const appointmentObjectId = new mongoose.Types.ObjectId(id);

    // 🔹 Ищем записи аудита
    const history = await AppointmentAudit.find({
      appointmentId: appointmentObjectId,
    })
      .populate(
        "byUserId",
        "role emailEncrypted firstNameEncrypted lastNameEncrypted"
      )
      .sort({ createdAt: -1 })
      .lean();

    if (!history || history.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: tReq(req, "app.history.notFound") });
    }

    return res.status(200).json({ success: true, data: history });
  } catch (err) {
    console.error("❌ Ошибка getAppointmentAudit:", err);
    return res
      .status(500)
      .json({ success: false, message: tReq(req, "app.server.error2") + err.message });
  }
};
