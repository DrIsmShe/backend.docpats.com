import { DateTime } from "luxon";
import DoctorSchedule from "../../../common/models/Appointment/doctorSchedule.js";
import Appointment from "../../../common/models/Appointment/appointment.js";
import ProfileDoctor from "../../../common/models/DoctorProfile/profileDoctor.js";

const DEFAULT_TZ = "Asia/Baku";

/**
 * Локальное "HH:MM" на конкретную дату в зоне расписания → UTC JS Date.
 * ВАРИАНТ B: расписание хранится как naive "HH:MM" + timezone.
 * Инстант собирается ТОЛЬКО здесь, с явной зоной. Никаких `new Date("...Z")`.
 */
function localToUtc(dateStr, hhmm, zone) {
  return DateTime.fromISO(`${dateStr}T${hhmm}`, { zone }).toUTC();
}

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

    // Зона расписания — единственный источник истины для локального времени
    const zone = schedule.timezone || DEFAULT_TZ;

    // ============================================================
    // 📅 2. Проверка исключений (чёрные даты)
    // ============================================================
    const exception = schedule.exceptions?.find((ex) => ex.date === date);

    if (exception?.isDayOff) {
      return res.status(200).json({
        success: true,
        slots: [],
        message: "❌ Этот день полностью заблокирован врачом",
      });
    }

    // ============================================================
    // 🕘 3. День недели — в ЗОНЕ расписания, не в UTC
    //    Модель: dow 0=Вс..6=Сб (как getDay). Luxon weekday 1=Пн..7=Вс.
    //    weekday % 7:  Пн1..Сб6 остаются, Вс7 → 0.
    // ============================================================
    const dayInZone = DateTime.fromISO(date, { zone });
    if (!dayInZone.isValid) {
      return res.status(400).json({
        success: false,
        message: "Некорректная дата",
      });
    }
    const dayOfWeek = dayInZone.weekday % 7;

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
      (i) => !i.type || i.type === type,
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
    // 🧮 4. Генерация всех возможных слотов (в UTC, из локальной зоны)
    // ============================================================
    // Предрассчёт заблокированных интервалов дня → [ms,ms] в UTC
    const blockedRanges = (exception?.blockedIntervals || []).map((b) => ({
      start: localToUtc(date, b.start, zone).toMillis(),
      end: localToUtc(date, b.end, zone).toMillis(),
    }));

    const allSlots = [];

    for (const interval of intervals) {
      const startUtc = localToUtc(date, interval.start, zone);
      const endUtc = localToUtc(date, interval.end, zone);
      const stepMin = interval.slotMinutes || 20;

      let cursor = startUtc;
      while (cursor < endUtc) {
        const slotEnd = cursor.plus({ minutes: stepMin });
        if (slotEnd > endUtc) break; // не выходим за конец интервала

        const cursorMs = cursor.toMillis();
        const isBlocked = blockedRanges.some(
          (r) => cursorMs >= r.start && cursorMs < r.end,
        );

        if (!isBlocked) {
          allSlots.push({
            start: cursor.toISO(), // UTC ISO (…Z)
            end: slotEnd.toISO(),
          });
        }
        cursor = slotEnd;
      }
    }

    // ============================================================
    // 🔒 5. Проверка занятых слотов (pending / confirmed)
    //    Границы дня — в ЗОНЕ расписания, конвертированные в UTC.
    // ============================================================
    const dayStartUtc = dayInZone.startOf("day").toUTC().toJSDate();
    const dayEndUtc = dayInZone.endOf("day").toUTC().toJSDate();

    const busy = await Appointment.find({
      doctorId: schedule.doctorId,
      status: { $in: ["pending", "confirmed"] },
      startsAt: { $gte: dayStartUtc, $lt: dayEndUtc },
    });

    // Сравнение по мгновению (ms), а не по строковому формату ISO —
    // устойчивее к различиям сериализации Date/Luxon.
    const busyStartSet = new Set(
      busy.map((a) => new Date(a.startsAt).getTime()),
    );

    const freeSlots = allSlots.filter(
      (s) => !busyStartSet.has(new Date(s.start).getTime()),
    );

    // ============================================================
    // ✅ 6. Возврат результата
    // ============================================================
    return res.status(200).json({
      success: true,
      slots: freeSlots,
      timezone: zone, // фронт может показать «время по <зоне>»
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
