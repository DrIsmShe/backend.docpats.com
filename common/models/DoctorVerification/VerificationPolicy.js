import mongoose from "mongoose";

const VerificationPolicySchema = new mongoose.Schema(
  {
    jurisdictionCode: {
      type: String,
      required: true,
      unique: true,
      index: true,
    }, // AZ, TR, US-CA
    country: { type: String, required: true, index: true }, // Azerbaijan, Turkey (для UI)
    authorityName: { type: String, default: null }, // Минздрав/медсовет

    requiredDocuments: [
      {
        type: String,
        enum: ["diploma", "license", "specialization", "selfie"],
        required: true,
      },
    ],

    licenseRegex: { type: String, default: null },

    reVerificationPeriodYears: { type: Number, default: 5 },

    /*
     * Что можно врачу на каждом уровне доверия.
     *
     * basic — документы не поданы, на проверке или отклонены.
     * full  — verificationStatus === "approved".
     *
     * Поля читает common/middlewares/requireVerifiedDoctor.js. До него
     * матрица описывала намерение: ни allowAI, ни allowPayments, ни
     * allowTelemedicine не встречались в коде ни разу, и «ограничения»
     * существовали только в схеме.
     *
     * Записей в коллекции нет — и это рабочее состояние: без политики
     * действует встроенное правило (то же, что basic ниже). Политика
     * нужна там, где юрисдикция разрешает больше: например, страна, где
     * рецепт не требует подтверждённой лицензии.
     */
    trustMatrix: {
      basic: {
        allowAI: { type: Boolean, default: true },
        allowPayments: { type: Boolean, default: false },
        allowTelemedicine: { type: Boolean, default: false },
        // Рецепт печатается с номером лицензии, который врач вписал сам.
        allowPrescriptions: { type: Boolean, default: false },
        // Запись диагноза в карту пациента.
        allowMedicalRecords: { type: Boolean, default: false },
        // Публикация статьи от имени платформы.
        allowPublishing: { type: Boolean, default: false },
      },
      full: {
        allowAI: { type: Boolean, default: true },
        allowPayments: { type: Boolean, default: true },
        allowTelemedicine: { type: Boolean, default: true },
        allowPrescriptions: { type: Boolean, default: true },
        allowMedicalRecords: { type: Boolean, default: true },
        allowPublishing: { type: Boolean, default: true },
      },
    },

    // если лицензия истекла — авто понижение
    autoDowngradeOnExpiry: { type: Boolean, default: true },
  },
  { timestamps: true },
);

const VerificationPolicy =
  mongoose.models.VerificationPolicy ||
  mongoose.model("VerificationPolicy", VerificationPolicySchema);

export default VerificationPolicy;
