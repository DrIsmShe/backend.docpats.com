import mongoose from "mongoose";

const doctorEndorsementSchema = new mongoose.Schema(
  {
    fromDoctorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User", // доктор, который рекомендует
      required: true,
      index: true,
    },
    toDoctorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User", // доктор, которого рекомендуют
      required: true,
      index: true,
    },

    // За что именно рекомендует — опционально
    specializationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Specialization",
      default: null,
    },

    // Короткий комментарий коллеги (опционально)
    comment: {
      type: String,
      maxlength: 500,
      default: null,
      trim: true,
    },
    specializationName: { type: String, default: null },

    createdAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
  }
);

// 🔥 Один доктор может рекомендовать другого только один раз
doctorEndorsementSchema.index(
  { fromDoctorId: 1, toDoctorId: 1 },
  { unique: true }
);

// 🔥 Быстрый запрос "сколько рекомендаций получил доктор"
doctorEndorsementSchema.index({ toDoctorId: 1 });

const DoctorEndorsement =
  mongoose.models.DoctorEndorsement ||
  mongoose.model("DoctorEndorsement", doctorEndorsementSchema);

export default DoctorEndorsement;
