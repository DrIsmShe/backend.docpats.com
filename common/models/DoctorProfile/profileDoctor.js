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
    /* Состояние допуска.
     *
     * suspended и expired добавлены к прежней четвёрке, и это разные
     * вещи, которые нельзя сводить к rejected:
     *   rejected  — документы признаны негодными, нужны другие;
     *   suspended — допуск снят решением администратора (жалоба,
     *               расследование), документы при этом в порядке;
     *   expired   — срок документа вышел сам, никто ничего не решал.
     * Врачу они объясняются по-разному, и восстановление у них разное:
     * из expired выходят новым документом или продлением, из suspended —
     * решением того, кто приостановил. */
    verificationStatus: {
      type: String,
      enum: [
        "not_submitted",
        "pending",
        "approved",
        "rejected",
        "suspended",
        "expired",
      ],
      default: "not_submitted",
      index: true,
    },

    /* Докогда действует допуск.
     *
     * Берётся как САМАЯ РАННЯЯ дата окончания среди обязательных
     * документов: допуск держится на самом слабом из них. Лицензия до
     * 2030-го при сертификате специалиста до 2027-го означает допуск до
     * 2027-го, а не до 2030-го.
     *
     * null — срок не задан: так выглядят все допуски, выданные до
     * появления этого поля, и документы, у которых срока нет по природе
     * (диплом). Такой допуск НЕ истекает — молча закрыть доступ всем
     * действующим врачам было бы хуже любой просрочки. Срок появляется,
     * когда врач подаёт документ с датой, а администратор её
     * подтверждает.
     *
     * Проверяется НА КАЖДОМ ЗАПРОСЕ, а не только ночным заданием: крон
     * может не отработать — сервер перезапущен, задание выключено
     * тумблером, — и просроченный допуск продолжал бы открывать рецепты
     * до следующей ночи. */
    verificationExpiresAt: { type: Date, default: null, index: true },

    /* На какой ступени предупреждения остановились: 30, 7, 1 или 0 (день
       окончания). Нужна, чтобы письмо о «тридцати днях» ушло один раз, а
       не каждую ночь в течение этих тридцати дней. Сбрасывается в null
       при продлении. */
    verificationExpiryNoticeStage: { type: Number, default: null },

    /* Ручное продление администратором.
     *
     * ЗАЧЕМ ОТДЕЛЬНОЕ ПОЛЕ, А НЕ ПРАВКА verificationExpiresAt. Срок
     * допуска выводится из документов и пересчитывается при каждом
     * решении по любому из них. Продление, записанное прямо в
     * verificationExpiresAt, стёрлось бы при следующем же пересчёте —
     * врач переподал бы диплом, и допуск, продлённый администратором до
     * июня, вернулся бы к дате старой лицензии. Молча.
     *
     * Действующий срок = позднейшая из двух дат. Продление — это
     * осознанное решение человека, который видел основание (справку о
     * подаче на перевыпуск, письмо органа), и оно должно переживать
     * пересчёт по бумагам.
     *
     * Бессрочный допуск (verificationExpiresAt === null) продлевать
     * незачем, и продление на него не влияет. */
    verificationExtendedUntil: { type: Date, default: null },
    verificationExtendedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    verificationExtendedAt: { type: Date, default: null },
    verificationExtensionReason: { type: String, default: "" },
    verificationReviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    verificationReviewedAt: { type: Date, default: null },
    verificationReviewComment: { type: String, default: "" },

    verificationDocuments: { type: [String], default: [] },

    // Номер врачебной лицензии. Печатается в графе «Регистрационный номер»
    // на бланке рецепта, который врач выписывает вне клиники: без него
    // бланк в аптеке недействителен, а хранились до сих пор только сканы
    // документов — из файла номер не подставишь.
    //
    // Не шифруем: это профессиональный идентификатор, он и так стоит на
    // каждом выписанном рецепте, а по нему ищут в реестрах.
    licenseNumber: { type: String, trim: true, maxlength: 100, default: null },

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

    clinic: {
      type: String,
      required: false,
      trim: true,
      validate: {
        validator: (v) => v && v.trim().length > 0,
        message: "Clinic cannot be empty",
      },
    },

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

    // Видео-визитка — ролик из каталога DocPats, а не ссылка наружу (в
    // отличие от videos[] выше, куда кладут чужие материалы: лекции,
    // выступления). Отдельное поле, потому что визитка ровно одна и у неё
    // особое место на карточке врача.
    //
    // Хранится ссылкой, а не снимком: если врач переснял визитку, посетитель
    // должен видеть новую. Это противоположно согласию, где снимок обязателен
    // именно потому, что доказывает прошлое.
    introVideoId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Video",
      default: null,
    },
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
  },
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
userDoctorSchema.pre("save", function (next) {
  if (this.isModified("verificationStatus")) {
    this.isVerified = this.verificationStatus === "approved";
  }
  next();
});

/**
 * Действует ли допуск ПРЯМО СЕЙЧАС.
 *
 * Одно место, где сходятся статус и срок, — чтобы «approved» и «approved,
 * но просрочен» нельзя было перепутать, читая только поле статуса. Именно
 * этой путаницей допуск и держался бы вечно: лицензия истекла, а
 * verificationStatus остался "approved" навсегда.
 *
 * Работает и на обычном документе, и на .lean()-объекте: принимает голые
 * поля, а не this.
 */
export function допускДействует(профиль, момент = new Date()) {
  if (!профиль) return false;
  if (профиль.verificationStatus !== "approved") return false;
  const до = действуетДо(профиль);
  // Срока нет — допуск бессрочный. См. комментарий у verificationExpiresAt.
  if (!до) return true;
  return до > момент;
}

/**
 * Действующая дата окончания допуска.
 *
 * Позднейшая из двух: выведенной из документов и ручного продления. null
 * означает бессрочно — тогда продление ни на что не влияет.
 */
export function действуетДо(профиль) {
  if (!профиль?.verificationExpiresAt) return null;
  const поБумагам = new Date(профиль.verificationExpiresAt);
  if (!профиль.verificationExtendedUntil) return поБумагам;
  const продление = new Date(профиль.verificationExtendedUntil);
  return продление > поБумагам ? продление : поБумагам;
}

/* ================================ Статики =============================== */
/** Поиск по номеру (любой формат → E.164 → hash) */
userDoctorSchema.statics.findByPhone = async function (phone) {
  const e164 = toE164OrThrow(phone);
  return this.findOne({ phoneHash: hashPhone(e164) });
};
userDoctorSchema.index({
  clinic: "text",
  about: "text",
  country: "text",
});
const ProfileDoctor =
  mongoose.models.DoctorProfile ||
  mongoose.model("DoctorProfile", userDoctorSchema);

export default ProfileDoctor;
