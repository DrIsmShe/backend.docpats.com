import mongoose from "mongoose";

const AuditLogSchema = new mongoose.Schema(
  {
    actor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false,
      index: true,
    },
    actorRole: {
      type: String,
      enum: ["doctor", "admin", "system", "clinic_admin", "clinic_staff"],
      required: true,
      index: true,
    },

    action: { type: String, required: true, index: true },

    entityType: {
      type: String,
      enum: [
        "DoctorVerification",
        "User",
        "File",
        "VerificationPolicy",
        "RiskSignal",
        "Case",
      ],
      required: true,
      index: true,
    },

    entityId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },

    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },

    ip: { type: String, default: null },
    userAgent: { type: String, default: null },

    riskScore: { type: Number, default: 0 },
  },
  { timestamps: true },
);

AuditLogSchema.index({ createdAt: -1 });
AuditLogSchema.index({ entityType: 1, entityId: 1, createdAt: -1 });

const AuditLog =
  mongoose.models.AuditLog || mongoose.model("AuditLog", AuditLogSchema);
export default AuditLog;
