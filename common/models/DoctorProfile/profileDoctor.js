// common/models/profileDoctor.js
import parsePhoneNumberFromString from "libphonenumber-js";
import mongoose from "mongoose";
import {
  encryptPhone,
  decryptPhone,
  hashPhone,
} from "../../middlewares/cryptoPhone.js"; // проверьте путь

/**
 * Профиль врача:
 * - Телефон хранится в шифре + hash (для поиска)
 * - Рекомендации от пациентов: recommendations (array of User ObjectId)
 */
const userDoctorSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    // ✅ Добавляем возможность онлайн-приёма
    allowVideo: { type: Boolean, default: true },
    company: { type: String, trim: true },

    isVerified: { type: Boolean, default: false },
    specialty: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Specialization",
      default: null,
    },

    verificationDocuments: { type: [String], default: [] },

    // Образование / специализация
    educationInstitution: { type: String, default: null },
    educationStartYear: { type: Number, default: null },
    educationEndYear: { type: Number, default: null },
    specializationInstitution: { type: String, default: null },
    specializationStartYear: { type: Number, default: null },
    specializationEndYear: { type: Number, default: null },

    address: { type: String, trim: true },

    // Телефон — только в шифре + hash
    phoneEncrypted: { type: String, default: null, select: true },
    phoneHash: {
      type: String,
      index: true,
      unique: true,
      sparse: true, // чтобы несколько null не конфликтовали
      default: null,
      select: false, // наружу не отдаём
    },

    clinic: { type: String, required: true, trim: true },

    profileImage: { type: String },

    about: { type: String, maxlength: 6200 },

    country: { type: String, trim: true, index: true },

    /** ← НОВОЕ: кто из пользователей рекомендовал врача */
    recommendations: [
      { type: mongoose.Schema.Types.ObjectId, ref: "User", default: undefined },
    ],

    // Произвольные данные
    books: [
      {
        title: { type: String, required: true },
        author: { type: String, required: true },
        publishedYear: { type: Number },
      },
    ],
    videos: [
      {
        title: { type: String, required: true },
        url: { type: String, required: true },
        uploadedAt: { type: Date, default: Date.now },
      },
    ],
    library: [
      {
        title: { type: String, required: true },
        type: { type: String, required: true },
        referenceId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "LibraryItem",
        },
      },
    ],

    outpatientPatients: [
      {
        patientId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Patient",
          required: true,
        },
        visitDate: { type: Date, required: true },
      },
    ],
    inpatientPatients: [
      {
        patientId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Patient",
          required: true,
        },
        admissionDate: { type: Date, required: true },
      },
    ],

    comments: [
      {
        content: { type: String, required: true },
        createdAt: { type: Date, default: Date.now },
        articleId: { type: mongoose.Schema.Types.ObjectId, ref: "Article" },
        videoId: { type: mongoose.Schema.Types.ObjectId, ref: "Video" },
      },
    ],

    lessons: [
      {
        title: { type: String, required: true },
        content: { type: String, required: true },
        createdAt: { type: Date, default: Date.now },
      },
    ],

    consultations: [
      {
        patientId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Patient",
          required: true,
        },
        date: { type: Date, required: true },
        notes: { type: String },
      },
    ],

    videoConferences: [
      {
        title: { type: String, required: true },
        date: { type: Date, required: true },
        link: { type: String, required: true },
      },
    ],

    createdAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

/* ========================= Индексы ========================= */
userDoctorSchema.index({ userId: 1, country: 1 });
userDoctorSchema.index({ clinic: 1 });
userDoctorSchema.index({ recommendations: 1 }); // быстрые проверки "рекомендовал ли пользователь"

/* ======================= Нормализация телефона (E.164) ======================= */
function toE164OrThrow(val) {
  if (val == null || val === "") return null;
  const str = String(val).trim();
  const withPlus = str.startsWith("+") ? str : `+${str}`;
  const parsed = parsePhoneNumberFromString(withPlus);
  if (!parsed || !parsed.isValid()) {
    throw new mongoose.Error.ValidatorError({
      path: "phoneNumber",
      message:
        "Invalid phone number format. Please use international format (e.g., +123456789).",
      value: val,
    });
  }
  return parsed.number; // уже E.164
}

/* ===================== Виртуал phoneNumber (get/set) ====================== */
userDoctorSchema
  .virtual("phoneNumber")
  .get(function () {
    if (!this.phoneEncrypted) return null;
    try {
      const plain = decryptPhone(this.phoneEncrypted);
      return plain || null;
    } catch {
      return null;
    }
  })
  .set(function (val) {
    if (val == null || val === "") {
      this.phoneEncrypted = null;
      this.phoneHash = null;
      return;
    }
    const e164 = toE164OrThrow(val);
    this.phoneEncrypted = encryptPhone(e164);
    this.phoneHash = hashPhone(e164);
  });

/* =========================== Виртуалы удобства =========================== */
// Кол-во рекомендаций (для UI)
userDoctorSchema.virtual("recommendCount").get(function () {
  return Array.isArray(this.recommendations) ? this.recommendations.length : 0;
});

/* =============================== Валидация =============================== */
userDoctorSchema.path("phoneEncrypted").validate(function () {
  if (this.phoneEncrypted == null) return true;
  try {
    const plain = decryptPhone(this.phoneEncrypted);
    const parsed = parsePhoneNumberFromString(plain);
    return !!(parsed && parsed.isValid());
  } catch {
    return false;
  }
}, "Invalid encrypted phone payload.");

/* ============================ Трансформации ============================== */
userDoctorSchema.set("toJSON", {
  virtuals: true,
  transform: (_doc, ret) => {
    delete ret.phoneEncrypted;
    delete ret.phoneHash;
    delete ret.__v;
    return ret;
  },
});
userDoctorSchema.set("toObject", { virtuals: true });

/* ================================ Хуки ================================== */
userDoctorSchema.pre("save", function (next) {
  if (this.isModified("phoneEncrypted")) {
    try {
      const plain = this.phoneEncrypted
        ? decryptPhone(this.phoneEncrypted)
        : null;
      this.phoneHash = plain ? hashPhone(plain) : null;
    } catch {
      this.phoneHash = null;
    }
  }
  next();
});

/* ================================ Статики =============================== */
/** Поиск по номеру (любой формат → E.164 → hash) */
userDoctorSchema.statics.findByPhone = async function (phone) {
  const e164 = toE164OrThrow(phone);
  return this.findOne({ phoneHash: hashPhone(e164) });
};

const ProfileDoctor =
  mongoose.models.DoctorProfile ||
  mongoose.model("DoctorProfile", userDoctorSchema);

export default ProfileDoctor;
