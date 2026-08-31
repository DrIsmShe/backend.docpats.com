import DoctorSchedule from "../../../common/models/Appointment/doctorSchedule.js";
import Appointment from "../../../common/models/Appointment/appointment.js";
import ProfileDoctor from "../../../common/models/DoctorProfile/profileDoctor.js";
import { tReq } from "../../../common/i18n/index.js";
import { errorText } from "../../../common/i18n/index.js";
import {
  buildDaySlots,
  dayBoundsUtc,
} from "../../../common/services/daySlots.service.js";

/**
 * @desc Публичный просмотр доступных слотов врача (для пациента)
 * @route GET /schedule/doctor-schedule/public-slots/:date/:type?doctorId=...
 * @access Public
 *
 * Генерация слотов вынесена в common/services/daySlots.service.js — тот же
 * код теперь обслуживает и календарь врача. Раньше логика жила только здесь,
 * и сетка в кабинете врача рисовалась отдельными «часами с 8 до 17», не
 * имевшими к расписанию никакого отношения.
 */
export const getDoctorSlotsPublic = async (req, res) => {
  try {
    const { date, type } = req.params;
    const { doctorId } = req.query;

    if (!doctorId || !date || !type) {
      return res.status(400).json({
        success: false,
        message: tReq(req, "app.parameters.required"),
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
        message: tReq(req, "app.doctor.scheduleNotFound"),
        slots: [],
      });
    }

    // ============================================================
    // 🧮 2. Слоты дня по расписанию
    // ============================================================
    const built = buildDaySlots({ schedule, date, type });

    if (!built.ok) {
      const message =
        built.reason === "invalid_date"
          ? "Некорректная дата"
          : built.reason === "day_off"
            ? "❌ Этот день полностью заблокирован врачом"
            : `Нет доступных ${type === "video" ? "онлайн" : "оффлайн"} интервалов`;

      if (built.reason === "invalid_date") {
        return res.status(400).json({ success: false, message });
      }
      return res.status(200).json({ success: true, slots: [], message });
    }

    // ============================================================
    // 🔒 3. Вычитаем занятые (pending / confirmed)
    // ============================================================
    const { startUtc, endUtc } = dayBoundsUtc(date, built.zone);

    const busy = await Appointment.find({
      doctorId: schedule.doctorId,
      status: { $in: ["pending", "confirmed"] },
      startsAt: { $gte: startUtc, $lt: endUtc },
    });

    // Сравнение по мгновению (ms), а не по строковому формату ISO —
    // устойчивее к различиям сериализации Date/Luxon.
    const busyStartSet = new Set(
      busy.map((a) => new Date(a.startsAt).getTime()),
    );

    // Прошедшее время слотом не является.
    //
    // Раньше отсеивались только занятые интервалы, а прошедшие оставались:
    // на вчерашний день пациенту показывалась полная сетка, и запись
    // спокойно создавалась. Сегодняшний день страдал тем же — в шесть
    // вечера предлагалось «свободное» девять утра.
    //
    // Отсекаем именно здесь, а не в buildDaySlots: тот же генератор рисует
    // календарь врачу, и там прошедшие интервалы дня нужны — врач видит по
    // ним, как прошёл день.
    const nowMs = Date.now();

    const freeSlots = built.slots.filter(
      (s) =>
        !busyStartSet.has(new Date(s.start).getTime()) &&
        new Date(s.start).getTime() > nowMs,
    );

    // ============================================================
    // ✅ 4. Возврат результата
    // ============================================================
    return res.status(200).json({
      success: true,
      slots: freeSlots,
      timezone: built.zone, // фронт может показать «время по <зоне>»
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
      message: tReq(req, "app.slots.loadError"),
      error: errorText(error, req),
    });
  }
};
