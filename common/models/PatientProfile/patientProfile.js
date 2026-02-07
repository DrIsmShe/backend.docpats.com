import mongoose from "mongoose";

const patientSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    photo: { type: String, trim: true, default: undefined },
    company: { type: String, trim: true, default: undefined },
    job: { type: String, trim: true, default: undefined },
    country: { type: String, trim: true, default: undefined },
    address: { type: String, trim: true, default: undefined },

    educationInstitution: { type: String, trim: true, default: undefined },
    educationStartYear: { type: Number, default: undefined },
    educationEndYear: { type: Number, default: undefined },

    specializationInstitution: { type: String, trim: true, default: undefined },
    specializationStartYear: { type: Number, default: undefined },
    specializationEndYear: { type: Number, default: undefined },

    // ⚠️ НЕ ставим unique на поле — уникальность зададим индексом ниже
    everyoneEmail: {
      type: String,
      trim: true,
      lowercase: true,
      default: undefined,
    },

    messengerId: { type: String, trim: true, default: undefined },

    isVerified: { type: Boolean, default: false },
    verificationDocuments: { type: [String], default: [] },
    isConsentGiven: { type: Boolean, default: false },

    // ⚠️ НЕ ставим unique на поле — уникальность зададим индексом ниже
    identityDocument: {
      type: String,
      trim: true,
      default: undefined,
    },

    about: { type: String, maxlength: 6200, default: undefined },

    articles: [
      {
        title: String,
        content: String,
        createdAt: { type: Date, default: Date.now },
      },
    ],
    books: [{ title: String, author: String, publishedYear: Number }],
    videos: [
      {
        title: String,
        url: String,
        uploadedAt: { type: Date, default: Date.now },
      },
    ],
    library: [
      {
        title: String,
        type: String,
        referenceId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "LibraryItem",
        },
      },
    ],

    outDoctor: [
      {
        doctorId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "DoctorProfile",
        },
        visitDate: Date,
      },
    ],
    inDoctor: [
      {
        doctorId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "DoctorProfile",
        },
        admissionDate: Date,
      },
    ],

    comments: [{ type: mongoose.Schema.Types.ObjectId, ref: "Comment" }],

    lessons: [
      {
        title: String,
        content: String,
        createdAt: { type: Date, default: Date.now },
      },
    ],
    consultations: [
      {
        doctorId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "DoctorProfile",
        },
        date: Date,
        notes: String,
      },
    ],
    videoConferences: [{ title: String, date: Date, link: String }],

    tags: { type: [String], default: [] },
    metaDescription: { type: [String], default: [] },
    metaKeywords: { type: [String], default: [] },
    isPublished: { type: Boolean, default: false },
    views: { type: Number, default: 0 },

    doctorId: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    files: [{ type: mongoose.Schema.Types.ObjectId, ref: "File" }],

    status: {
      type: String,
      enum: ["Pending", "In Progress", "Completed", "Cancelled"],
      default: "Pending",
    },
    paymentStatus: {
      type: String,
      enum: ["Pending", "Paid", "Partially Paid", "Cancelled"],
      default: "Pending",
    },
    amountPaid: { type: mongoose.Schema.Types.Decimal128, default: 0.0 },
    totalCost: { type: mongoose.Schema.Types.Decimal128, default: 0.0 },

    history: [
      {
        updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
        updatedAt: { type: Date, default: Date.now },
        changes: [
          {
            field: String,
            oldValue: mongoose.Schema.Types.Mixed,
            newValue: mongoose.Schema.Types.Mixed,
          },
        ],
      },
    ],
    insuranceInformation: { type: String, trim: true, default: undefined },
    visitHistory: { type: String, trim: true, default: undefined },
    socialStatus: { type: String, trim: true, default: undefined },
    maritalStatus: { type: String, trim: true, default: undefined },
    children: { type: String, trim: true, default: undefined },

    createdAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

/** ---------- Индексы ---------- **/

// Частичная уникальность: только если значение непустая строка
patientSchema.index(
  { everyoneEmail: 1 },
  {
    unique: true,
    partialFilterExpression: { everyoneEmail: { $type: "string", $ne: "" } },
    name: "uniq_everyoneEmail_not_empty",
  }
);

patientSchema.index(
  { identityDocument: 1 },
  {
    unique: true,
    partialFilterExpression: { identityDocument: { $type: "string", $ne: "" } },
    name: "uniq_identityDocument_not_empty",
  }
);

// Ускорители
patientSchema.index({ userId: 1 }, { name: "by_userId" });
patientSchema.index({ createdAt: -1 }, { name: "by_createdAt_desc" });

// (старый индекс по firstName/lastName/phoneNumber удалён — этих полей в этой модели нет)

// Виртуальная связь с историей болезни
patientSchema.virtual("medicalHistories", {
  ref: "newPatientMedicalHistory",
  localField: "_id",
  foreignField: "patientId",
});

const PatientProfile =
  mongoose.models.PatientProfile ||
  mongoose.model("PatientProfile", patientSchema);

export default PatientProfile;
