import DoctorSchedule from "../../../common/models/Appointment/doctorSchedule.js";
import Appointment from "../../../common/models/Appointment/appointment.js";
import ProfileDoctor from "../../../common/models/DoctorProfile/profileDoctor.js";

/**
 * @desc Публичный просмотр доступных слотов врача (для пациента)
 * @route GET /schedule/doctor-schedule/public-slots/:date/:type?doctorId=...
 * @access Public
 */
export const getDoctorSlotsPublic = async (req, res) => {
  try {
    const { date, type } = req.params;
    const { doctorId } = req.query;

    if (!doctorId || !date || !type) {
      return res.status(400).json({
        success: false,
        message: "Необходимо передать doctorId, date и type",
      });
    }

    // ============================================================
    // 🔍 1. Поиск расписания врача
    // ============================================================
    let schedule = await DoctorSchedule.findOne({ doctorId });

    if (!schedule) {
      // пробуем найти по userId
      const profile = await ProfileDoctor.findOne({
        $or: [{ _id: doctorId }, { userId: doctorId }],
      }).lean();

      if (profile) {
        schedule = await DoctorSchedule.findOne({ doctorId: profile._id });
      }
    }

    if (!schedule) {
      return res.status(404).json({
        success: false,
        message: "Расписание врача не найдено",
        slots: [],
      });
    }

    // ============================================================
    // 📅 2. Проверка исключений (чёрные даты)
    // ============================================================
    const exception = schedule.exceptions?.find((ex) => ex.date === date);

    // Полностью заблокированный день
    if (exception?.isDayOff) {
      return res.status(200).json({
        success: true,
        slots: [],
        message: "❌ Этот день полностью заблокирован врачом",
      });
    }

    // ============================================================
    // 🕘 3. Определяем расписание по дню недели
    // ============================================================
    const day = new Date(date);
    const dayOfWeek = day.getUTCDay();

    const daySchedule = schedule.weekly.find((d) => d.dow === dayOfWeek);
    if (!daySchedule || !daySchedule.intervals?.length) {
      return res.status(200).json({
        success: true,
        slots: [],
        message: "На выбранный день у врача нет приёма",
      });
    }

    // фильтрация по типу (offline / video)
    const intervals = daySchedule.intervals.filter(
      (i) => !i.type || i.type === type
    );
    if (!intervals.length) {
      return res.status(200).json({
        success: true,
        slots: [],
        message: `Нет доступных ${
          type === "video" ? "онлайн" : "оффлайн"
        } интервалов`,
      });
    }

    // ============================================================
    // 🧮 4. Генерация всех возможных слотов
    // ============================================================
    const allSlots = [];

    for (const interval of intervals) {
      const start = new Date(`${date}T${interval.start}:00Z`);
      const end = new Date(`${date}T${interval.end}:00Z`);
      const step = (interval.slotMinutes || 20) * 60 * 1000;

      for (let t = start; t < end; t = new Date(t.getTime() + step)) {
        const slotEnd = new Date(t.getTime() + step);

        // 🚫 Пропускаем, если попадает в заблокированные интервалы
        const isBlocked = exception?.blockedIntervals?.some((blocked) => {
          const bStart = new Date(`${date}T${blocked.start}:00Z`);
          const bEnd = new Date(`${date}T${blocked.end}:00Z`);
          return t >= bStart && t < bEnd;
        });

        if (!isBlocked) {
          allSlots.push({
            start: t.toISOString(),
            end: slotEnd.toISOString(),
          });
        }
      }
    }

    // ============================================================
    // 🔒 5. Проверка занятых слотов (pending / confirmed)
    // ============================================================
    const busy = await Appointment.find({
      doctorId: schedule.doctorId,
      status: { $in: ["pending", "confirmed"] },
      startsAt: {
        $gte: new Date(`${date}T00:00:00Z`),
        $lt: new Date(`${date}T23:59:59Z`),
      },
    });

    const busySet = new Set(
      busy.map((a) => `${a.startsAt.toISOString()}_${a.endsAt.toISOString()}`)
    );

    const freeSlots = allSlots.filter(
      (s) => !busySet.has(`${s.start}_${s.end}`)
    );

    // ============================================================
    // ✅ 6. Возврат результата
    // ============================================================
    return res.status(200).json({
      success: true,
      slots: freeSlots,
      total: freeSlots.length,
      message:
        freeSlots.length > 0
          ? "✅ Слоты успешно загружены"
          : "❌ На выбранную дату нет доступных слотов",
    });
  } catch (error) {
    console.error("❌ Ошибка при получении слотов врача:", error);
    res.status(500).json({
      success: false,
      message: "Ошибка сервера при загрузке слотов",
      error: error.message,
    });
  }
};
