// common/models/DoctorPrivatePatient.js
import mongoose from "mongoose";

const { Schema } = mongoose;

// Можно вынести в константы, чтобы переиспользовать
const GENDER_ENUM = ["male", "female", "other", "unknown"];

const LINK_STATUS_ENUM = [
  "none", // нет попыток связать с аккаунтом
  "suggested", // система/врач предложили связать
  "linked", // уже привязан к реальному пациентскому аккаунту
  "rejected", // врач/пациент отказались связывать
];

const doctorPrivatePatientSchema = new Schema(
  {
    // -----------------------------------
    // 1. Связь с врачом (владелец записи)
    // -----------------------------------
    doctorProfileId: {
      type: Schema.Types.ObjectId,
      ref: "DoctorProfile", // твоя модель профиля врача
      required: true,
      index: true,
    },
    image: {
      type: String,
      trim: true,
    },

    // Если хочешь дублировать связь и с User
    doctorUserId: {
      type: Schema.Types.ObjectId,
      ref: "User", // системный пользователь-врач
      index: true,
    },

    // -----------------------------------
    // 2. Основная идентификация пациента
    // -----------------------------------
    firstName: {
      type: String,
      trim: true,
    },
    lastName: {
      type: String,
      trim: true,
    },
    middleName: {
      type: String,
      trim: true,
    },

    // Полное имя на случай, если врач вбивает одним полем
    fullName: {
      type: String,
      trim: true,
      index: true,
    },

    gender: {
      type: String,
      enum: GENDER_ENUM,
      default: "unknown",
    },

    dateOfBirth: {
      type: Date,
    },

    // Любой внешний идентификатор, который врач сам использует:
    // номер карты, история болезни, номер амбулаторной карты и т.п.
    externalId: {
      type: String,
      trim: true,
    },

    // -----------------------------------
    // 3. Контактные данные пациента
    // -----------------------------------
    phone: {
      type: String,
      trim: true,
    },

    // Если хочешь в будущем шифровать, можно сразу подготовить:
    phoneEncrypted: {
      type: String,
      trim: true,
    },
    phoneHash: {
      type: String,
      index: true,
    },

    email: {
      type: String,
      trim: true,
      lowercase: true,
    },

    // Пример адреса (можно упростить)
    address: {
      country: { type: String, trim: true },
      city: { type: String, trim: true },
      street: { type: String, trim: true },
      house: { type: String, trim: true },
      apartment: { type: String, trim: true },
    },

    // -----------------------------------
    // 4. Клиническая информация (минимально)
    // -----------------------------------
    mainComplaint: {
      type: String,
      trim: true,
    },

    mainDiagnosisText: {
      type: String,
      trim: true,
    },

    // Например, ICD-10 код, если врач любит кодировать
    mainDiagnosisCode: {
      type: String,
      trim: true,
    },

    // Теги для фильтрации в списке
    tags: [
      {
        type: String,
        trim: true,
      },
    ],

    // Свободные заметки врача про пациента
    notes: {
      type: String,
      trim: true,
    },

    // -----------------------------------
    // 5. Связь с "настоящим" пациентом (если он есть в системе)
    // -----------------------------------

    // Если пациент имеет системный аккаунт User
    linkedUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      index: true,
    },

    // Если у тебя есть отдельный профиль пациента (поликлиника / стационар)
    linkedPatientProfileId: {
      type: Schema.Types.ObjectId,
      ref: "NewPatientPolyclinic", // или "PatientProfile" в твоём проекте
      index: true,
    },

    linkStatus: {
      type: String,
      enum: LINK_STATUS_ENUM,
      default: "none",
    },

    // История попыток "слияния" / привязки
    linkHistory: [
      {
        status: {
          type: String,
          enum: LINK_STATUS_ENUM,
        },
        changedAt: {
          type: Date,
          default: Date.now,
        },
        changedBy: {
          type: Schema.Types.ObjectId,
          ref: "User", // кто менял статус
        },
        comment: {
          type: String,
          trim: true,
        },
      },
    ],

    // -----------------------------------
    // 6. Статусы и управление списком
    // -----------------------------------
    isFavorite: {
      type: Boolean,
      default: false, // для "избранных" пациентов в списке
    },

    isArchived: {
      type: Boolean,
      default: false, // если пациент больше не наблюдается
      index: true,
    },

    archivedAt: {
      type: Date,
    },

    archiveReason: {
      type: String,
      trim: true,
    },

    // -----------------------------------
    // 7. Служебные поля / аудит
    // -----------------------------------
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User", // кто фактически создал (врач или ассистент)
    },

    updatedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
  },
  {
    timestamps: true, // createdAt, updatedAt
  },
);

// -----------------------------------
// ВИРТУАЛЫ (например, возраст)
// -----------------------------------
doctorPrivatePatientSchema.virtual("age").get(function () {
  if (!this.dateOfBirth) return null;
  const today = new Date();
  let age = today.getFullYear() - this.dateOfBirth.getFullYear();
  const m = today.getMonth() - this.dateOfBirth.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < this.dateOfBirth.getDate())) {
    age--;
  }
  return age;
});

// Можно сделать fullName автоматически, если не заполнено
doctorPrivatePatientSchema.pre("save", function (next) {
  if (!this.fullName) {
    const parts = [this.lastName, this.firstName, this.middleName].filter(
      Boolean,
    );
    if (parts.length > 0) {
      this.fullName = parts.join(" ");
    }
  }
  next();
});

// Индекс для списков врача
doctorPrivatePatientSchema.index({
  doctorProfileId: 1,
  isArchived: 1,
  fullName: 1,
});

// Индекс для поиска по телефону внутри конкретного врача
doctorPrivatePatientSchema.index({
  doctorProfileId: 1,
  phoneHash: 1,
});

const DoctorPrivatePatient =
  mongoose.models.DoctorPrivatePatient ||
  mongoose.model("DoctorPrivatePatient", doctorPrivatePatientSchema);

export default DoctorPrivatePatient;
