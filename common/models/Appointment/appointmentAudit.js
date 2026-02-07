import mongoose from "mongoose";

/**
 * 📘 AppointmentAudit — журнал действий с приёмами
 * Логирует все изменения: создание, подтверждение, отмену, завершение и т.д.
 *
 * Поддерживает связь:
 *  - byUserId — кто совершил (врач, пациент, админ)
 *  - targetPatientId — к какому пациенту относится (через NewPatientPolyclinic)
 */

const appointmentAuditSchema = new mongoose.Schema(
  {
    /* ============================================================
       🔗 Ссылки
    ============================================================ */
    appointmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Appointment",
      required: true,
      index: true,
    },

    // 👤 Пациент (через NewPatientPolyclinic)
    targetPatientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "NewPatientPolyclinic",
      required: false,
      index: true,
    },

    // 🧑‍⚕️ Кто совершил действие
    byUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    /* ============================================================
       ⚙️ Детали действия
    ============================================================ */
    action: {
      type: String,
      enum: [
        "create",
        "update",
        "delete",
        "confirmed",
        "cancelled",
        "completed",
        "noshow",
        "refund",
        "rescheduled",
        "system",
        "video_session_completed",
        // ⬇️ НОВОЕ
        "whatsapp_attached",
      ],
      required: true,
      trim: true,
    },

    reason: {
      type: String,
      maxlength: 500,
      trim: true,
      default: null,
    },

    meta: {
      ip: { type: String, default: null },
      userAgent: { type: String, default: null },
      device: { type: String, default: null },
    },

    isSystem: { type: Boolean, default: false },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

/* Индексы */
appointmentAuditSchema.index({ appointmentId: 1, createdAt: -1 });
appointmentAuditSchema.index({ byUserId: 1 });
appointmentAuditSchema.index({ targetPatientId: 1 });
appointmentAuditSchema.index({ action: 1 });
appointmentAuditSchema.index({ isSystem: 1 });

/* Виртуальное поле */
appointmentAuditSchema.virtual("summary").get(function () {
  return `${this.action} by ${this.byUserId || "system"}`;
});

appointmentAuditSchema.set("toJSON", {
  virtuals: true,
  transform: (_, ret) => {
    delete ret._id;
    return ret;
  },
});

appointmentAuditSchema.set("toObject", { virtuals: true });

export default mongoose.model("AppointmentAudit", appointmentAuditSchema);
