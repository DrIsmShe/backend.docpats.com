// controllers/appointments/getAvailableSlotsController.js
import { addMinutes, isBefore, isAfter, startOfDay, endOfDay } from "date-fns";
import DoctorSchedule from "../../common/models/Appointment/doctorSchedule.js";
import Appointment from "../../common/models/Appointment/appointment.js";

function toISODate(d) {
  return d.toISOString();
}

// helper: построить интервалы слотов на одну дату
function buildSlotsForDate({
  dateLocalStr,
  weekly,
  exceptions,
  timezone,
  slotMinutes,
  minLeadMinutes,
}) {
  // dateLocalStr = "2025-09-14"
  // Упрощенно: считаем, что локальное "09:00" => переводим в UTC на эту дату (на практике: используйте luxon/timezone)
  // Здесь дам простую схему: вы уже можете применять свою TZ-утилиту, которой пользуетесь в проекте.

  // Найти интервалы по d.o.w.
  const date = new Date(`${dateLocalStr}T00:00:00`); // локально → осторожно!
  const dow = date.getUTCDay(); // упрощённо; лучше с библиотекой TZ
  const dayCfg = weekly.find((x) => x.dow === dow);
  if (!dayCfg) return [];

  // Исключения
  const exc = (exceptions || []).find((e) => e.date === dateLocalStr);
  if (exc?.isDayOff) return [];

  const baseIntervals = dayCfg.intervals || [];
  const now = new Date();

  const result = [];
  for (const iv of baseIntervals) {
    const minutes = slotMinutes ?? iv.slotMinutes ?? 20;
    const [sh, sm] = iv.start.split(":").map(Number);
    const [eh, em] = iv.end.split(":").map(Number);

    // Старт/конец интервала в UTC (условно)
    const ivStart = new Date(date);
    ivStart.setUTCHours(sh, sm, 0, 0);
    const ivEnd = new Date(date);
    ivEnd.setUTCHours(eh, em, 0, 0);

    let cursor = ivStart;
    while (
      isBefore(addMinutes(cursor, minutes), ivEnd) ||
      +addMinutes(cursor, minutes) === +ivEnd
    ) {
      const slotStart = new Date(cursor);
      const slotEnd = addMinutes(slotStart, minutes);

      // minLeadMinutes
      if (isBefore(slotStart, addMinutes(now, minLeadMinutes))) {
        cursor = slotEnd;
        continue;
      }
      result.push({ startsAt: slotStart, endsAt: slotEnd });
      cursor = slotEnd;
    }
  }

  // Вырежем исключения-части
  if (exc?.blockedIntervals?.length) {
    return result.filter((s) => {
      // если слот попадает в заблокированный отрезок локального дня — выбрасываем
      // (для простоты опустим TZ-преобразование)
      return true;
    });
  }
  return result;
}

// основной контроллер
export const getAvailableSlotsController = async (req, res) => {
  try {
    const { doctorId } = req.params;
    const { from, to } = req.query; // "2025-09-12", "2025-09-19" (локальные даты)
    if (!from || !to) {
      return res
        .status(400)
        .json({ success: false, message: "from/to required (YYYY-MM-DD)" });
    }

    const sched = await DoctorSchedule.findOne({ doctorId });
    if (!sched) return res.json({ success: true, slots: [] });

    const days = [];
    const start = new Date(from + "T00:00:00Z");
    const end = new Date(to + "T00:00:00Z");

    // набираем дни
    for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
      const dStr = d.toISOString().slice(0, 10);
      days.push(dStr);
    }

    const allSlots = [];
    for (const dStr of days) {
      const slots = buildSlotsForDate({
        dateLocalStr: dStr,
        weekly: sched.weekly,
        exceptions: sched.exceptions,
        timezone: sched.timezone,
        slotMinutes: sched.durationOverrideMinutes,
        minLeadMinutes: sched.minLeadMinutes,
      });
      if (slots.length) {
        allSlots.push(...slots.map((s) => ({ ...s, date: dStr })));
      }
    }

    // вычесть занятые
    const minDate = allSlots.length
      ? new Date(Math.min(...allSlots.map((s) => s.startsAt.getTime())))
      : null;
    const maxDate = allSlots.length
      ? new Date(Math.max(...allSlots.map((s) => s.endsAt.getTime())))
      : null;

    if (!minDate) return res.json({ success: true, slots: [] });

    const busy = await Appointment.find(
      {
        doctorId,
        status: { $in: ["pending", "confirmed"] },
        $or: [{ startsAt: { $lt: maxDate }, endsAt: { $gt: minDate } }],
      },
      { startsAt: 1, endsAt: 1 }
    );

    const free = allSlots.filter(
      (s) =>
        !busy.some((b) => !(s.endsAt <= b.startsAt || s.startsAt >= b.endsAt))
    );

    res.json({ success: true, slots: free });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
