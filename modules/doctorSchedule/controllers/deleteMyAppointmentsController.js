// server/modules/doctorSchedule/controllers/deleteMyAppointmentsController.js
import mongoose from "mongoose";
import Appointment from "../../../common/models/Appointment/appointment.js";
import ProfileDoctor from "../../../common/models/DoctorProfile/profileDoctor.js";
import { tReq } from "../../../common/i18n/index.js";
import { errorText } from "../../../common/i18n/index.js";

/**
 * @desc Удаление приёмов врача — одиночное или массовое
 * @route DELETE /schedule/appointment/delete/:id
 *        DELETE /schedule/appointment/delete?appointmentId=...
 *        DELETE /schedule/appointment/delete?all=true
 * @access Private (doctor only)
 */
const deleteMyAppointmentsController = async (req, res) => {
  try {
    const doctorUserId = req.userId; // user._id врача из сессии/токена
    const { appointmentId, all } = req.query;
    const idFromParams = req.params?.id;

    if (!doctorUserId) {
      return res.status(401).json({
        success: false,
        message: tReq(req, "app.auth.unauthorized"),
      });
    }

    // --- Собираем все возможные doctorId, которые могли попасть в Appointment ---
    const profile = await ProfileDoctor.findOne({ userId: doctorUserId })
      .select("_id userId")
      .lean()
      .catch(() => null);

    // Массив допустимых идентификаторов врача (как в доках, так и в профиле)
    const doctorIdCandidates = [
      doctorUserId, // user._id
      profile?._id, // profileDoctor._id
      profile?.userId, // profileDoctor.userId (дублируем на всякий случай)
    ]
      .filter(Boolean)
      .map((x) => x.toString());

    // Вспомогательный фильтр по врачам
    const doctorFilter = { doctorId: { $in: doctorIdCandidates } };

    // --- Массовое удаление ---
    if (all === "true") {
      const result = await Appointment.deleteMany(doctorFilter);
      return res.status(200).json({
        success: true,
        deletedCount: result.deletedCount || 0,
        message: `Удалено ${result.deletedCount || 0} приём(ов) врача.`,
      });
    }

    // --- Одиночное удаление ---
    const targetId = (appointmentId || idFromParams || "").trim();

    if (!targetId) {
      return res.status(400).json({
        success: false,
        message:
          tReq(req, "app.appointment.delete.parameterMissing"),
      });
    }

    if (!mongoose.Types.ObjectId.isValid(targetId)) {
      return res.status(400).json({
        success: false,
        message: tReq(req, "app.appointment.invalidId2"),
      });
    }

    // 1) Пытаемся удалить с учётом всех возможных doctorId
    const deleted = await Appointment.findOneAndDelete({
      _id: targetId,
      ...doctorFilter,
    });

    // 2) Если не нашли — проверим, не принадлежит ли вообще этот приём другому врачу.
    if (!deleted) {
      const exists = await Appointment.findById(targetId)
        .select("doctorId")
        .lean();
      if (!exists) {
        return res.status(404).json({
          success: false,
          message: tReq(req, "app.appointment.notFound2"),
        });
      }

      const belongsToDoctor = doctorIdCandidates.includes(
        exists.doctorId?.toString?.()
      );

      if (!belongsToDoctor) {
        return res.status(403).json({
          success: false,
          message: tReq(req, "app.appointment.belongsToAnotherDoctor"),
        });
      }

      // Теоретически сюда не попадём, но на всякий случай:
      return res.status(500).json({
        success: false,
        message: tReq(req, "app.appointment.deleteFailed"),
      });
    }

    return res.status(200).json({
      success: true,
      message: tReq(req, "app.appointment.deleteSuccess"),
      deletedId: deleted._id,
    });
  } catch (error) {
    console.error("Ошибка при удалении приёмов:", error);
    return res.status(500).json({
      success: false,
      message: tReq(req, "app.appointment.deleteServerError"),
      error: errorText(error, req),
    });
  }
};

export default deleteMyAppointmentsController;
