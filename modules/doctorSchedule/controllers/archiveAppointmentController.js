import mongoose from "mongoose";
import Appointment from "../../../common/models/Appointment/appointment.js";
import ProfileDoctor from "../../../common/models/DoctorProfile/profileDoctor.js";
import { tReq } from "../../../common/i18n/index.js";

const archiveAppointmentController = async (req, res) => {
  try {
    const userId = req.userId;
    const { id } = req.params;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: tReq(req, "app.access.unauthorized"),
      });
    }

    // 🩺 Находим профиль врача по userId
    const doctorProfile = await ProfileDoctor.findOne({ userId });
    if (!doctorProfile) {
      return res.status(404).json({
        success: false,
        message: tReq(req, "app.doctor.profile.notFound"),
      });
    }

    const doctorProfileId = doctorProfile._id;

    // 🔍 Ищем приём по doctorProfileId
    const appointment = await Appointment.findOne({
      _id: id,
      doctorId: doctorProfileId,
    });

    if (!appointment) {
      console.warn(
        `⚠️ Приём ${id} не найден или не принадлежит врачу ${doctorProfileId}`
      );
      return res.status(404).json({
        success: false,
        message: tReq(req, "app.appointment.notFoundOrUnauthorized"),
      });
    }

    if (appointment.isArchived) {
      return res.status(400).json({
        success: false,
        message: tReq(req, "app.appointment.alreadyArchived"),
      });
    }

    appointment.isArchived = true;
    appointment.archivedAt = new Date();
    await appointment.save();

    console.log(
      `📦 Приём ${appointment._id} архивирован врачом ${doctorProfileId}`
    );

    return res.status(200).json({
      success: true,
      message: tReq(req, "app.appointment.archiveSuccess"),
      data: appointment,
    });
  } catch (error) {
    console.error("❌ Ошибка архивирования приёма:", error);
    return res.status(500).json({
      success: false,
      message: tReq(req, "app.appointment.archiveError"),
      error: error.message,
    });
  }
};

export default archiveAppointmentController;
