import Appointment from "../../../common/models/Appointment/appointment.js";
import ProfileDoctor from "../../../common/models/DoctorProfile/profileDoctor.js";
import { tReq } from "../../../common/i18n/index.js";

/**
 * @desc Получение архивированных приёмов врача
 * @route GET /schedule/appointment/archived
 * @access Private (doctor)
 */
const getArchivedAppointmentsController = async (req, res) => {
  try {
    const userId = req.userId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: tReq(req, "app.auth.unauthorized2"),
      });
    }

    // 🔍 Находим профиль врача по userId
    const doctorProfile = await ProfileDoctor.findOne({ userId }).select("_id");
    if (!doctorProfile) {
      return res.status(404).json({
        success: false,
        message: tReq(req, "app.doctor.profile.notFound"),
      });
    }

    // 🔹 Получаем архивированные приёмы этого врача
    const archivedAppointments = await Appointment.find({
      doctorId: doctorProfile._id,
      isArchived: true,
    })
      .populate("patientId", "firstNameEncrypted lastNameEncrypted")
      .sort({ endsAt: -1 })
      .lean();

    return res.status(200).json({
      success: true,
      count: archivedAppointments.length,
      data: archivedAppointments,
    });
  } catch (error) {
    console.error("❌ Ошибка при получении архивированных приёмов:", error);
    return res.status(500).json({
      success: false,
      message: tReq(req, "app.archive.serverError"),
      error: error.message,
    });
  }
};

export default getArchivedAppointmentsController;
