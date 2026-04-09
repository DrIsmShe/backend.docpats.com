import mongoose from "mongoose";

const doctorVerificationDocumentSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, required: true },

    doctorProfileId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DoctorProfile",
      required: true,
      index: true,
    },

    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    documentType: {
      type: String,
      enum: [
        "license",
        "diploma",
        "certificate",
        "passport",
        "id_card",
        "other",
      ],
      required: true,
      index: true,
    },

    fileUrl: { type: String, required: true },
    fileName: { type: String, default: null },
    fileMime: { type: String, default: null },
    fileSize: { type: Number, default: null },
    isArchivedByDoctor: {
      type: Boolean,
      default: false,
      index: true,
    },

    archivedAt: {
      type: Date,
      default: null,
    },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
      index: true,
    },

    reviewedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },

    reviewComment: { type: String, default: "" },
    reviewedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

doctorVerificationDocumentSchema.index({ doctorProfileId: 1, status: 1 });
doctorVerificationDocumentSchema.index({ userId: 1, createdAt: -1 });

const DoctorVerificationDocument =
  mongoose.models.DoctorVerificationDocument ||
  mongoose.model(
    "DoctorVerificationDocument",
    doctorVerificationDocumentSchema,
  );

export default DoctorVerificationDocument;
