// server/modules/doctorSchedule/controllers/doctorScheduleController.js
import DoctorSchedule from "../../../common/models/Appointment/doctorSchedule.js";
import Appointment from "../../../common/models/Appointment/appointment.js";
import ProfileDoctor from "../../../common/models/DoctorProfile/profileDoctor.js";

/**
/**
 * @desc Получить расписание текущего врача
 * @route GET /schedule/doctor-schedule/me
 * @access Doctor
 */
export const getMySchedule = async (req, res) => {
  try {
    const userId = req.userId;
    const profile = await ProfileDoctor.findOne({ userId }).lean();

    if (!profile) {
      return res
        .status(404)
        .json({ success: false, message: "Профиль врача не найден" });
    }

    const doctorId = profile._id;
    const schedule = await DoctorSchedule.findOne({ doctorId }).lean();

    if (!schedule) {
      return res.status(200).json({
        success: true,
        message: "У вас пока нет расписания",
        data: {
          doctorId,
          weekly: [],
          timezone: "Asia/Baku",
          bufferMinutes: 10,
          autoApprove: true,
          allowVideo: true,
        },
      });
    }

    res.json({ success: true, data: schedule });
  } catch (err) {
    console.error("❌ Ошибка getMySchedule:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * @desc Создать или обновить расписание врача
 * @route POST /schedule/doctor-schedule
 * @access Doctor
 */
export const createOrUpdateSchedule = async (req, res) => {
  try {
    const userId = req.userId;
    const data = req.body || {};

    const profile = await ProfileDoctor.findOne({ userId }).lean();
    if (!profile) {
      return res
        .status(404)
        .json({ success: false, message: "Профиль врача не найден" });
    }

    const doctorId = profile._id;

    const schedule = await DoctorSchedule.findOneAndUpdate(
      { doctorId },
      {
        $set: {
          weekly: data.weekly || [],
          timezone: data.timezone || "Asia/Baku",
          bufferMinutes: data.bufferMinutes || 10,
          autoApprove: data.autoApprove ?? true,
          allowVideo: data.allowVideo ?? true,
        },
      },
      { new: true, upsert: true },
    ).lean();

    res.json({
      success: true,
      message: "✅ Расписание успешно сохранено",
      data: schedule,
    });
  } catch (err) {
    console.error("❌ Ошибка createOrUpdateSchedule:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * @desc Получить доступные слоты для выбранной даты
 * @route GET /doctor/schedule/slots/:date
 * @access Doctor
 */
export const getAvailableSlots = async (req, res) => {
  try {
    const userId = req.userId;
    const { date } = req.params;

    // 🔹 Находим профиль врача
    const profile = await ProfileDoctor.findOne({ userId }).lean();
    if (!profile)
      return res
        .status(404)
        .json({ success: false, message: "Профиль врача не найден" });

    const doctorId = profile._id;

    // 🔹 Находим расписание
    const schedule = await DoctorSchedule.findOne({ doctorId });
    if (!schedule)
      return res
        .status(404)
        .json({ success: false, message: "Расписание не найдено" });

    // 🔹 Генерируем доступные слоты
    const slots =
      typeof schedule.generateSlotsForDate === "function"
        ? schedule.generateSlotsForDate(date)
        : [];

    res.json({ success: true, slots });
  } catch (err) {
    console.error("❌ Ошибка getAvailableSlots:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * @desc Получить все приёмы текущего врача
 * @route GET /doctor/schedule/appointments
 * @access Doctor
 */
export const getDoctorAppointments = async (req, res) => {
  try {
    const userId = req.userId;

    // 🔹 1. Находим профиль врача
    const profile = await ProfileDoctor.findOne({ userId }).lean();
    if (!profile)
      return res
        .status(404)
        .json({ success: false, message: "Профиль врача не найден" });

    const doctorId = profile._id;

    // 🔹 2. Загружаем приёмы
    const appointments = await Appointment.find({ doctorId })
      .populate("patientId", "firstNameEncrypted lastNameEncrypted")
      .sort({ startsAt: 1 })
      .lean();

    if (!appointments.length) {
      return res.status(200).json({
        success: true,
        message: "У вас пока нет приёмов",
        data: [],
      });
    }

    res.json({ success: true, data: appointments });
  } catch (err) {
    console.error("❌ Ошибка получения приёмов врача:", err);
    res.status(500).json({ success: false, message: err.message });
  }
};
