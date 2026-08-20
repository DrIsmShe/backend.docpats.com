// common/models/appointment.js
import mongoose from "mongoose";

const appointmentSchema = new mongoose.Schema(
  {
    doctorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DoctorProfile", // профиль врача, не NewPatientPolyclinic
      required: true,
      index: true,
    },
    doctorIdUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    // ─── КТО ПАЦИЕНТ ────────────────────────────────────────────────────
    // Ровно одна из двух ссылок (проверяется в pre-validate ниже).
    //
    // patientId — пациент С АККАУНТОМ. Ему уходят уведомления и напоминания.
    // privatePatientId — карточка приватного пациента врача: сюда попадает и
    // «человек с улицы», которого врач записал по телефону или на пороге.
    // Отдельной сущности для таких людей нет намеренно: у DoctorPrivatePatient
    // уже есть шифрование ФИО/телефона, blind-index phoneHash для поиска и
    // linkedUserId/migrationStatus — когда человек зарегистрируется, карточка
    // вместе с историей приёмов привязывается к аккаунту, ничего не перенося.
    //
    // required снят с patientId (было true): запись врача на непривязанного
    // пациента иначе невозможна.
    patientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "NewPatientPolyclinic", // профиль пациента поликлиники
      default: null,
      index: true,
    },

    privatePatientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DoctorPrivatePatient",
      default: null,
      index: true,
    },

    // Кто создал запись. Нужно и для аудита, и для текста уведомления:
    // «вы записались» и «вас записал врач» — разные события для пациента.
    bookedBy: {
      type: String,
      enum: ["patient", "doctor"],
      default: "patient",
    },

    // Приём вне сетки расписания (врач принял срочного пациента). Слот
    // всё равно занимает и пересекаться с другими приёмами не может —
    // пометка нужна, чтобы отличать его в календаре и в отчётах.
    offSchedule: { type: Boolean, default: false },
    isArchived: {
      type: Boolean,
      default: false,
    },
    archivedAt: {
      type: Date,
    },

    // Время всегда храним в UTC (Date). Фронт показывает по timezone врача/пациента.
    startsAt: { type: Date, required: true, index: true },
    endsAt: { type: Date, required: true },

    type: { type: String, enum: ["offline", "video"], default: "offline" },
    // ⬇️ НОВОЕ
    channel: {
      type: String,
      enum: ["internal", "whatsapp", "zoom"],
      default: "internal",
    },
    // ================== 💬 WhatsApp ==================
    whatsApp: {
      phone: {
        type: String,
        default: null,
        validate: {
          validator: (v) => !v || /^\d{10,15}$/.test(v),
          message: "Invalid WhatsApp phone format",
        },
      },

      providedBy: {
        type: String,
        enum: ["patient", "doctor", "registry"],
        default: "patient",
      },

      activatedAt: {
        type: Date,
        default: null,
      },
    },

    location: { type: String, default: null }, // адрес/кабинет или ссылка на видеокомнату

    // Статусы
    status: {
      type: String,
      enum: [
        "pending",
        "confirmed",
        "cancelled",
        "completed",
        "no_show",
        "refunded",
      ],
      default: "pending",
    },

    // Оплата/цены (AZN как базовая валюта)
    priceAZN: { type: Number, default: 0 },
    payment: {
      required: { type: Boolean, default: false }, // нужна ли предоплата/холд
      method: {
        type: String,
        enum: ["none", "stripe", "iyzico", "local"],
        default: "none",
      },
      currency: { type: String, default: "AZN" },
      amount: { type: Number, default: 0 }, // в валюте платежа
      status: {
        type: String,
        enum: [
          "not_needed",
          "requires_payment",
          "authorized",
          "paid",
          "refunded",
          "failed",
        ],
        default: "not_needed",
      },
      providerIntentId: { type: String, default: null }, // paymentIntent/checkoutId и т.п.
      capturedAt: { type: Date, default: null },
      refundedAt: { type: Date, default: null },
    },
    callSession: {
      startedAt: { type: Date },
      endedAt: { type: Date },
      durationSeconds: { type: Number, default: 0 },
      wasVideo: { type: Boolean, default: false },
      reportNote: { type: String, default: "" }, // можно использовать позже
    },

    // Отметки об отправленных напоминаниях (jobs/appointmentReminders.job.js).
    // Хранятся на самой записи, а не в отдельной коллекции: напоминание
    // привязано к приёму и умирает вместе с ним.
    // Нужны для идемпотентности — задача поднимается каждые 5 минут, и без
    // отметки пациент получал бы одно и то же напоминание двенадцать раз в
    // час. Дата, а не boolean: видно, когда именно ушло.
    reminders: {
      sent24h: { type: Date, default: null },
      sent1h: { type: Date, default: null },
      sent10m: { type: Date, default: null },
    },

    // Служебные
    notesPatient: { type: String, maxlength: 1000 },
    notesDoctor: { type: String, maxlength: 2000 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

    // Для быстрого поиска пересечений — уникальный ключ на доктора/время
    uniqueKey: {
      type: String,
      required: true,
      unique: true,
      // формируем как `${doctorId}_${startsAt.toISOString()}_${endsAt.toISOString()}`
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);
appointmentSchema.index(
  { doctorId: 1, startsAt: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: ["pending", "confirmed"] } },
  },
);
// Ровно одна ссылка на пациента. Ни одной — приём в никуда; обе — два
// разных человека на одном времени, и непонятно, кому напоминать.
appointmentSchema.pre("validate", function (next) {
  const hasUser = Boolean(this.patientId);
  const hasPrivate = Boolean(this.privatePatientId);
  if (!hasUser && !hasPrivate) {
    return next(
      new Error("Appointment requires patientId or privatePatientId"),
    );
  }
  if (hasUser && hasPrivate) {
    return next(
      new Error("Appointment cannot have both patientId and privatePatientId"),
    );
  }
  next();
});

appointmentSchema.pre("validate", function (next) {
  if (!this.uniqueKey && this.doctorId && this.startsAt && this.endsAt) {
    this.uniqueKey = `${
      this.doctorId
    }_${this.startsAt.toISOString()}_${this.endsAt.toISOString()}`;
  }
  next();
});
appointmentSchema.statics.hasConflict = async function (
  doctorId,
  startsAt,
  endsAt,
) {
  return await this.exists({
    doctorId,
    status: { $in: ["pending", "confirmed"] },
    $or: [
      { startsAt: { $lt: endsAt }, endsAt: { $gt: startsAt } }, // пересечение
    ],
  });
};
appointmentSchema.index(
  { updatedAt: 1 },
  {
    expireAfterSeconds: 60 * 60 * 24 * 365,
    partialFilterExpression: { status: "cancelled" },
  },
);
appointmentSchema.virtual("durationMinutes").get(function () {
  return (this.endsAt - this.startsAt) / 60000;
});
appointmentSchema.pre("save", function (next) {
  if (typeof this.startsAt === "string")
    this.startsAt = new Date(this.startsAt);
  if (typeof this.endsAt === "string") this.endsAt = new Date(this.endsAt);
  next();
});
appointmentSchema.virtual("formattedTime").get(function () {
  return {
    start: this.startsAt.toISOString(),
    end: this.endsAt.toISOString(),
    duration: this.durationMinutes + " min",
  };
});
appointmentSchema.index({ status: 1, startsAt: 1 });

appointmentSchema.index({ doctorId: 1, startsAt: 1, endsAt: 1 });
appointmentSchema.index({ patientId: 1, startsAt: 1 });
// «Все приёмы этого приватного пациента» — история карточки открывается
// так же часто, как история обычного пациента.
appointmentSchema.index(
  { privatePatientId: 1, startsAt: 1 },
  { partialFilterExpression: { privatePatientId: { $type: "objectId" } } },
);
appointmentSchema.pre("save", function (next) {
  if (
    this.channel === "whatsapp" &&
    (!this.whatsApp.phone || this.whatsApp.phone.length === 0)
  ) {
    return next(new Error("WhatsApp phone is required for WhatsApp channel"));
  }

  // ⛔ WhatsApp только для video
  if (this.type === "offline" && this.channel === "whatsapp") {
    return next(
      new Error("WhatsApp channel is allowed only for video appointments"),
    );
  }

  // 🔄 Если WhatsApp — это video
  if (this.channel === "whatsapp") {
    this.type = "video";

    if (!this.whatsApp.activatedAt) {
      this.whatsApp.activatedAt = new Date();
    }
  }

  // 🧹 Очистка после завершения
  if (this.isModified("status") && this.status === "completed") {
    this.whatsApp = {
      phone: null,
      providedBy: "patient",
      activatedAt: null,
    };
    this.channel = "internal";
  }

  next();
});

export default mongoose.models.Appointment ||
  mongoose.model("Appointment", appointmentSchema);
