// server/modules/clinic/clinic-staff/models/membershipRequest.model.js
//
// MembershipRequest — a clinic owner/admin invites an EXISTING DocPats doctor
// (User) to join the clinic. Unlike StaffInvitation (external email + OTP for
// new ClinicEmployees), this targets a user already in the system: no email,
// token, or OTP. The doctor accepts/rejects inside their cabinet.
//
// On accept → a ClinicMembership is created via the existing addStaff path.
// This keeps ClinicMembership "clean" (only real members), mirroring the
// consent_requests pattern (pending → approve creates the real link).
//
// Lifecycle: pending → accepted | rejected | cancelled | expired

import mongoose from "mongoose";

const STATUSES = ["pending", "accepted", "rejected", "cancelled", "expired"];

const membershipRequestSchema = new mongoose.Schema(
  {
    clinicId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Clinic",
      required: true,
      index: true,
    },

    // The invited DocPats user (doctor).
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // Proposed role + title for the future membership.
    role: { type: String, required: true },
    customTitle: { type: String, trim: true, maxlength: 200, default: "" },
    employmentType: { type: String, default: null },

    status: {
      type: String,
      enum: STATUSES,
      default: "pending",
      required: true,
      index: true,
    },

    // Who sent the invite (owner/admin User).
    invitedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    // Denormalized clinic name at invite time (for the doctor's UI without
    // an extra populate; the live name is still resolved on display).
    clinicName: { type: String, default: "" },

    respondedAt: { type: Date, default: null },
    expiresAt: { type: Date, default: null, index: true },

    // When accepted, the membership that was created (audit link).
    membershipId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ClinicMembership",
      default: null,
    },
  },
  { timestamps: true, collection: "membership_requests" },
);

// Only ONE pending request per (clinic, user). Once resolved, a new invite
// is allowed.
membershipRequestSchema.index(
  { clinicId: 1, userId: 1, status: 1 },
  { unique: true, partialFilterExpression: { status: "pending" } },
);

// Fast lookup of a doctor's pending invitations across clinics.
membershipRequestSchema.index({ userId: 1, status: 1, createdAt: -1 });

const MembershipRequest =
  mongoose.models.MembershipRequest ||
  mongoose.model("MembershipRequest", membershipRequestSchema);

export const MEMBERSHIP_REQUEST_STATUSES = STATUSES;
export default MembershipRequest;
