import mongoose from "mongoose";

/* ============================================================
   📅 Справочник дней недели (0 = воскресенье ... 6 = суббота)
============================================================ */
const dayOfWeekEnum = [0, 1, 2, 3, 4, 5, 6];

/* ============================================================
   🕘 Схема рабочего интервала (включая тип приёма)
============================================================ */
const workingIntervalSchema = new mongoose.Schema(
  {
    start: { type: String, required: true }, // "09:00"
    end: { type: String, required: true }, // "13:00"
    slotMinutes: { type: Number, default: 20, min: 5, max: 240 },
    type: { type: String, enum: ["offline", "video"], default: "offline" },
  },
  { _id: false }
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
  { _id: false }
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
  }
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
   🧮 Метод: генерация слотов для конкретной даты
============================================================ */
doctorScheduleSchema.methods.generateSlotsForDate = function (dateStr, type) {
  try {
    if (!dateStr) return [];

    const date = new Date(dateStr);
    if (isNaN(date)) return [];

    const dayOfWeek = date.getUTCDay();
    const daySchedule = this.weekly.find((d) => d.dow === dayOfWeek);
    if (!daySchedule || !daySchedule.intervals.length) return [];

    // Проверка на выходной день
    const exception = this.exceptions.find((e) => e.date === dateStr);
    if (exception?.isDayOff) return [];

    const slots = [];

    for (const interval of daySchedule.intervals) {
      if (type && interval.type !== type) continue;

      const [startHour, startMin] = interval.start.split(":").map(Number);
      const [endHour, endMin] = interval.end.split(":").map(Number);

      const slotMinutes = this.durationOverrideMinutes || interval.slotMinutes;
      const buffer = this.bufferMinutes || 0;

      let current = new Date(date);
      current.setUTCHours(startHour, startMin, 0, 0);

      const end = new Date(date);
      end.setUTCHours(endHour, endMin, 0, 0);

      while (current < end) {
        const next = new Date(current.getTime() + slotMinutes * 60000);

        // Проверка блокировок
        const isBlocked = exception?.blockedIntervals?.some((b) => {
          const [bh, bm] = b.start?.split(":").map(Number) || [];
          const [eh, em] = b.end?.split(":").map(Number) || [];
          if (bh == null || eh == null) return false;

          const blockStart = new Date(date);
          blockStart.setUTCHours(bh, bm, 0, 0);

          const blockEnd = new Date(date);
          blockEnd.setUTCHours(eh, em, 0, 0);

          return current >= blockStart && next <= blockEnd;
        });

        if (!isBlocked) {
          slots.push({
            start: current.toISOString(),
            end: next.toISOString(),
            type: interval.type,
          });
        }

        // Следующий слот + буфер
        current = new Date(next.getTime() + buffer * 60000);
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
============================================================ */
doctorScheduleSchema.index({ doctorId: 1 }, { unique: true });

/* ============================================================
   📦 Экспорт модели
============================================================ */
export default mongoose.models.DoctorSchedule ||
  mongoose.model("DoctorSchedule", doctorScheduleSchema);
