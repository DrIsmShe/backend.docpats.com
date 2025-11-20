import Appointment from "../../../common/models/Appointment/appointment.js";
import ProfileDoctor from "../../../common/models/DoctorProfile/profileDoctor.js";

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
        message: "Неавторизованный доступ.",
      });
    }

    // 🔍 Ищем профиль врача по userId
    const doctorProfile = await ProfileDoctor.findOne({ userId }).select("_id");
    if (!doctorProfile) {
      return res.status(404).json({
        success: false,
        message: "Профиль врача не найден.",
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
        message: "Приём не найден или уже активен.",
      });
    }

    // 🔧 Снимаем архив
    appointment.isArchived = false;
    appointment.archivedAt = null;
    await appointment.save();

    return res.status(200).json({
      success: true,
      message: "Приём успешно возвращён из архива.",
    });
  } catch (error) {
    console.error("❌ Ошибка при разархивировании:", error);
    return res.status(500).json({
      success: false,
      message: "Внутренняя ошибка при разархивировании.",
      error: error.message,
    });
  }
};

export default unarchiveAppointmentController;
