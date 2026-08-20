// server/common/services/daySlots.service.js
//
// Генератор слотов дня — ОДИН на всех.
//
// Зачем вынесено: сетку слотов теперь спрашивают двое — пациент, который
// выбирает время записи, и врач, который записывает пациента сам из своего
// календаря. Если у них разные генераторы, календарь начинает врать: врач
// видит 08:00, которого нет в расписании, пациент видит 09:20, которого нет
// у врача. Поэтому логика живёт здесь, а контроллеры только раскрашивают
// результат под свою роль.
//
// ВАРИАНТ B (как и было в getDoctorSlotsPublic): расписание хранит наивные
// "HH:MM" плюс timezone. Инстант (UTC) собирается ТОЛЬКО здесь, с явной
// зоной. Никаких `new Date("...Z")` над локальным временем.

import { DateTime } from "luxon";

export const DEFAULT_TZ = "Asia/Baku";

/** Локальное "HH:MM" на дату в зоне расписания → UTC. */
export function localToUtc(dateStr, hhmm, zone) {
  return DateTime.fromISO(`${dateStr}T${hhmm}`, { zone }).toUTC();
}

/**
 * Все слоты дня по расписанию — БЕЗ учёта занятости.
 *
 * @param {object}  p
 * @param {object}  p.schedule  документ DoctorSchedule
 * @param {string}  p.date      "YYYY-MM-DD" в зоне расписания
 * @param {string} [p.type]     "offline" | "video" — фильтр интервалов;
 *                              не передан → берутся все интервалы дня
 * @returns {{ok: boolean, reason?: string, zone: string, slots: Array<{start: string, end: string, type: string}>}}
 *
 * reason (когда ok=false): "invalid_date" | "day_off" | "no_intervals"
 * — контроллеры переводят его в свой текст, здесь текстов нет намеренно:
 * сервис не знает, на каком языке говорит вызывающий.
 */
export function buildDaySlots({ schedule, date, type = null }) {
  const zone = schedule?.timezone || DEFAULT_TZ;

  const dayInZone = DateTime.fromISO(date, { zone });
  if (!dayInZone.isValid) {
    return { ok: false, reason: "invalid_date", zone, slots: [] };
  }

  // Чёрная дата — день выключен целиком.
  const exception = schedule?.exceptions?.find((ex) => ex.date === date);
  if (exception?.isDayOff) {
    return { ok: false, reason: "day_off", zone, slots: [] };
  }

  // Модель: dow 0=Вс..6=Сб (как getDay). Luxon weekday 1=Пн..7=Вс.
  // weekday % 7: Пн1..Сб6 остаются, Вс7 → 0.
  const dayOfWeek = dayInZone.weekday % 7;
  const daySchedule = schedule?.weekly?.find((d) => d.dow === dayOfWeek);
  if (!daySchedule?.intervals?.length) {
    return { ok: false, reason: "no_intervals", zone, slots: [] };
  }

  const intervals = type
    ? daySchedule.intervals.filter((i) => !i.type || i.type === type)
    : daySchedule.intervals;

  if (!intervals.length) {
    return { ok: false, reason: "no_intervals", zone, slots: [] };
  }

  // Частично заблокированные куски дня → [ms, ms) в UTC.
  const blockedRanges = (exception?.blockedIntervals || []).map((b) => ({
    start: localToUtc(date, b.start, zone).toMillis(),
    end: localToUtc(date, b.end, zone).toMillis(),
  }));

  const slots = [];

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
        slots.push({
          start: cursor.toISO(), // UTC ISO (…Z)
          end: slotEnd.toISO(),
          type: interval.type || "offline",
        });
      }
      cursor = slotEnd;
    }
  }

  // Интервалы дня могут идти вразнобой (утро офлайн, вечер онлайн) —
  // сортируем, чтобы обе стороны видели день по порядку.
  slots.sort((a, b) => new Date(a.start) - new Date(b.start));

  return { ok: true, zone, slots };
}

/** Границы дня в зоне расписания → UTC. Нужны для выборки приёмов за день. */
export function dayBoundsUtc(date, zone = DEFAULT_TZ) {
  const dayInZone = DateTime.fromISO(date, { zone });
  return {
    startUtc: dayInZone.startOf("day").toUTC().toJSDate(),
    endUtc: dayInZone.endOf("day").toUTC().toJSDate(),
  };
}

export default { buildDaySlots, dayBoundsUtc, localToUtc, DEFAULT_TZ };
