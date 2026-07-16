import mongoose from "mongoose";
import { DateTime } from "luxon";

/* ============================================================
   📅 Справочник дней недели (0 = воскресенье ... 6 = суббота)
============================================================ */
const dayOfWeekEnum = [0, 1, 2, 3, 4, 5, 6];

/* ============================================================
   🕘 Схема рабочего интервала (включая тип приёма)
============================================================ */
const workingIntervalSchema = new mongoose.Schema(
  {
    start: { type: String, required: true }, // "09:00" — ЛОКАЛЬНОЕ время (см. timezone)
    end: { type: String, required: true }, // "13:00" — ЛОКАЛЬНОЕ время
    slotMinutes: { type: Number, default: 20, min: 5, max: 240 },
    type: { type: String, enum: ["offline", "video"], default: "offline" },
  },
  { _id: false },
);

/* ============================================================
   🚫 Схема исключений (чёрные даты, частичные блоки)
============================================================ */
const exceptionSchema = new mongoose.Schema(
  {
    date: { type: String, required: true }, // "2025-10-26"
    reason: { type: String },
    isDayOff: { type: Boolean, default: false },
    blockedIntervals: [
      {
        start: { type: String },
        end: { type: String },
      },
    ],
  },
  { _id: false },
);

/* ============================================================
   🩺 Основная схема расписания врача
============================================================ */
const doctorScheduleSchema = new mongoose.Schema(
  {
    doctorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ProfileDoctor",
      required: true,
      unique: true,
      index: true,
    },

    // ВАРИАНТ B: все "HH:MM" в weekly/exceptions трактуются в ЭТОЙ зоне.
    // Инстант (UTC) собирается только в момент генерации/создания записи.
    timezone: { type: String, default: "Asia/Baku" },

    /* === Еженедельное расписание === */
    weekly: [
      {
        dow: { type: Number, enum: dayOfWeekEnum, required: true },
        intervals: { type: [workingIntervalSchema], default: [] },
      },
    ],

    /* === Исключения === */
    exceptions: { type: [exceptionSchema], default: [] },

    /* === Настройки поведения === */
    autoApprove: { type: Boolean, default: true },
    allowVideo: { type: Boolean, default: true },
    minLeadMinutes: { type: Number, default: 60 },
    maxAdvanceDays: { type: Number, default: 60 },
    durationOverrideMinutes: { type: Number, default: null },
    bufferMinutes: { type: Number, default: 10 },

    /* === Оплата и праздники === */
    priceAZN: { type: Number, default: 0 },
    holidays: [{ date: String, description: String }],
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

/* ============================================================
   🔢 Виртуальное поле — эффективная длительность слота
============================================================ */
doctorScheduleSchema.virtual("effectiveSlotMinutes").get(function () {
  if (this.durationOverrideMinutes) return this.durationOverrideMinutes;

  const firstInterval =
    this.weekly?.[0]?.intervals?.[0]?.slotMinutes ?? this.bufferMinutes ?? 20;

  return firstInterval;
});

/* ============================================================
   🧮 Метод: генерация слотов для конкретной даты (ВАРИАНТ B)
   Локальные "HH:MM" → UTC через явную this.timezone.
   Никаких setUTCHours на локальном времени.
============================================================ */
doctorScheduleSchema.methods.generateSlotsForDate = function (dateStr, type) {
  try {
    if (!dateStr) return [];

    const zone = this.timezone || "Asia/Baku";

    // Локальное "HH:MM" на дату dateStr в зоне расписания → Luxon UTC DateTime
    const localToUtc = (hhmm) =>
      DateTime.fromISO(`${dateStr}T${hhmm}`, { zone }).toUTC();

    const dayInZone = DateTime.fromISO(dateStr, { zone });
    if (!dayInZone.isValid) return [];

    // Модель: dow 0=Вс..6=Сб. Luxon weekday 1=Пн..7=Вс → weekday % 7.
    const dayOfWeek = dayInZone.weekday % 7;
    const daySchedule = this.weekly.find((d) => d.dow === dayOfWeek);
    if (!daySchedule || !daySchedule.intervals.length) return [];

    const exception = this.exceptions.find((e) => e.date === dateStr);
    if (exception?.isDayOff) return [];

    // Предрассчёт заблокированных отрезков дня → [ms, ms] в UTC
    const blockedRanges = (exception?.blockedIntervals || [])
      .filter((b) => b?.start && b?.end)
      .map((b) => ({
        start: localToUtc(b.start).toMillis(),
        end: localToUtc(b.end).toMillis(),
      }));

    const slots = [];

    for (const interval of daySchedule.intervals) {
      if (type && interval.type !== type) continue;

      const slotMinutes = this.durationOverrideMinutes || interval.slotMinutes;
      const buffer = this.bufferMinutes || 0;

      const endUtc = localToUtc(interval.end);
      let cursor = localToUtc(interval.start);

      while (cursor < endUtc) {
        const next = cursor.plus({ minutes: slotMinutes });
        if (next > endUtc) break; // не выходим за конец интервала

        const sMs = cursor.toMillis();
        const eMs = next.toMillis();
        const isBlocked = blockedRanges.some(
          (r) => sMs >= r.start && eMs <= r.end,
        );

        if (!isBlocked) {
          slots.push({
            start: cursor.toISO(), // UTC ISO (…Z)
            end: next.toISO(),
            type: interval.type,
          });
        }

        // Следующий слот + буфер
        cursor = next.plus({ minutes: buffer });
      }
    }

    return slots;
  } catch (err) {
    console.error("❌ Ошибка при генерации слотов:", err);
    return [];
  }
};

/* ============================================================
   🔍 Индекс для уникальности врача
   doctorId уже задан на уровне поля как unique+index — повторный
   schema.index давал прод-warning "Duplicate schema index" и убран.
============================================================ */

/* ============================================================
   📦 Экспорт модели
============================================================ */
export default mongoose.models.DoctorSchedule ||
  mongoose.model("DoctorSchedule", doctorScheduleSchema);
