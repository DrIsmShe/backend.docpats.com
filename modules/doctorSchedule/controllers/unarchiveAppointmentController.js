import Appointment from "../../../common/models/Appointment/appointment.js";
import ProfileDoctor from "../../../common/models/DoctorProfile/profileDoctor.js";
import { tReq } from "../../../common/i18n/index.js";
import { errorText } from "../../../common/i18n/index.js";

/**
 * @desc Разархивировать приём (вернуть в активные)
 * @route PUT /schedule/appointment/unarchive/:id
 * @access Private (doctor)
 */
const unarchiveAppointmentController = async (req, res) => {
  try {
    const userId = req.userId;
    const { id } = req.params;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: tReq(req, "app.auth.unauthorized2"),
      });
    }

    // 🔍 Ищем профиль врача по userId
    const doctorProfile = await ProfileDoctor.findOne({ userId }).select("_id");
    if (!doctorProfile) {
      return res.status(404).json({
        success: false,
        message: tReq(req, "app.doctor.profile.notFound"),
      });
    }

    // 🔹 Ищем архивированный приём, принадлежащий врачу
    const appointment = await Appointment.findOne({
      _id: id,
      doctorId: doctorProfile._id,
      isArchived: true,
    });

    if (!appointment) {
      return res.status(404).json({
        success: false,
        message: tReq(req, "app.appointment.notFoundOrActive"),
      });
    }

    // 🔧 Снимаем архив
    appointment.isArchived = false;
    appointment.archivedAt = null;
    await appointment.save();

    return res.status(200).json({
      success: true,
      message: tReq(req, "app.appointment.restoredFromArchive"),
    });
  } catch (error) {
    console.error("❌ Ошибка при разархивировании:", error);
    return res.status(500).json({
      success: false,
      message: tReq(req, "app.archive.extractionError"),
      error: errorText(error, req),
    });
  }
};

export default unarchiveAppointmentController;
