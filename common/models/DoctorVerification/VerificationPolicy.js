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

    trustMatrix: {
      basic: {
        allowAI: { type: Boolean, default: true },
        allowPayments: { type: Boolean, default: false },
        allowTelemedicine: { type: Boolean, default: false },
      },
      full: {
        allowAI: { type: Boolean, default: true },
        allowPayments: { type: Boolean, default: true },
        allowTelemedicine: { type: Boolean, default: true },
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
