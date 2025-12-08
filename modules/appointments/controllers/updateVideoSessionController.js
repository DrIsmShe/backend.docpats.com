import Appointment from "../../../common/models/Appointment/appointment.js";

export const updateVideoSessionController = async (req, res) => {
  try {
    const { appointmentId } = req.params;
    const { startedAt, endedAt, durationSeconds } = req.body;
    const userId = req.userId;

    if (!userId) {
      return res
        .status(401)
        .json({ success: false, message: "Неавторизованный доступ" });
    }

    const appointment = await Appointment.findById(appointmentId);
    if (!appointment) {
      return res
        .status(404)
        .json({ success: false, message: "Приём не найден" });
    }

    appointment.callSession = {
      startedAt: startedAt
        ? new Date(startedAt)
        : appointment.callSession?.startedAt,
      endedAt: endedAt ? new Date(endedAt) : new Date(),
      durationSeconds: durationSeconds || 0,
      wasVideo: true,
    };

    await appointment.save();

    return res.json({
      success: true,
      message: "Отчёт о видеосессии сохранён",
      appointment,
    });
  } catch (err) {
    console.error("Ошибка при обновлении видеосессии:", err);
    res.status(500).json({ success: false, message: "Ошибка сервера" });
  }
};
