// modules/clinic/clinic-staff/models/clinicMembershipInvite.model.js
//
// ClinicMembershipInvite = a pending invitation for a person to join a clinic
// as a User-backed member (actorType "user"), e.g. an admin ("near-owner").
//
// DELIBERATELY separate from the employee-invite flow (StaffInvitation -> OTP +
// password -> ClinicEmployee). An admin is a DocPats User with a ClinicMembership,
// never a ClinicEmployee. Accepting this invite results in:
//   ClinicMembership({ userId, clinicId, role, actorType: "user", invitedBy })
//
// Token model (same hybrid as StaffInvitation):
//   - Service issues a signed token: createSignedToken({ inviteId }, "7d").
//   - Only sha256(token) is stored here (tokenHash); the raw token lives in the
//     emailed accept URL and is never persisted.
//   - On accept: verifySignedToken(token) (integrity + exp) then
//     findOne({ _id: inviteId, tokenHash }) — strict token binding (variant 2),
//     never a silent email match. As a safeguard the service also asserts the
//     accepting user's email === invite email.
//
// Email is encrypted at rest (emailEncrypted) + hashed for unique lookups
// (emailHash), reusing the exact crypto helpers from StaffInvitation so key
// handling stays identical across the invitation domain (HIPAA at-rest PHI).
//
// Expiry: no TTL index (kept for audit). expiresAt is REQUIRED and computed
// explicitly in the service before .create() — Mongoose `required` runs before
// pre-save hooks, so it is not populated by a hook. emailHash IS computed in a
// pre("validate") hook, which runs BEFORE the required check (mirrors StaffInvitation).

import mongoose from "mongoose";
import { ROLES } from "../../../../common/auth/permissions.js";
import {
  encryptValue,
  decryptValue,
  sha256,
  normalizeEmail,
} from "./staffInvitation.model.js";

const ALLOWED_ROLES = Object.values(ROLES);

export const MEMBERSHIP_INVITE_STATUS = Object.freeze({
  PENDING: "pending",
  ACCEPTED: "accepted",
  EXPIRED: "expired",
  REVOKED: "revoked",
});

const STATUSES = Object.values(MEMBERSHIP_INVITE_STATUS);
const SUPPORTED_LANGUAGES = ["ru", "en", "tr", "az", "ar"];

const isEncrypted = (v) => typeof v === "string" && v.includes(":");

const clinicMembershipInviteSchema = new mongoose.Schema(
  {
    clinicId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Clinic",
      required: true,
      index: true,
    },

    // Invited person's email — encrypted at rest, hashed for unique lookups.
    emailEncrypted: { type: String, required: true },
    emailHash: { type: String, required: true, index: true },

    // Role granted on accept. Model stays generic; WHICH roles may be invited
    // this way is policy enforced in the zod schema / service layer.
    role: { type: String, enum: ALLOWED_ROLES, required: true },

    customTitle: { type: String, trim: true, maxlength: 200 },

    // sha256(signedToken). Raw token never persisted.
    tokenHash: { type: String, required: true, unique: true, index: true },

    status: {
      type: String,
      enum: STATUSES,
      default: MEMBERSHIP_INVITE_STATUS.PENDING,
      index: true,
    },

    // Computed explicitly in service (see header note). Required, no default.
    expiresAt: { type: Date, required: true, index: true },

    // Owner (or FULL-STAFF_INVITE actor) who issued the invite.
    invitedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },

    // Populated on successful accept — the User that now holds the membership.
    acceptedByUserId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    acceptedAt: { type: Date, default: null },

    // Populated on revoke.
    revokedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    revokedAt: { type: Date, default: null },

    language: {
      type: String,
      enum: SUPPORTED_LANGUAGES,
      default: "ru",
    },
  },
  {
    timestamps: true,
    collection: "clinic_membership_invites",
  },
);

// At most ONE live (pending) invite per (clinic, email). Re-inviting after
// accept/expire/revoke is allowed because those rows fall outside the filter.
clinicMembershipInviteSchema.index(
  { clinicId: 1, emailHash: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: MEMBERSHIP_INVITE_STATUS.PENDING },
  },
);

// List a clinic's invites in the owner UI.
clinicMembershipInviteSchema.index({ clinicId: 1, status: 1, createdAt: -1 });

// Pre-validate: compute emailHash from plaintext, then encrypt.
// Runs BEFORE required-validation, so `emailHash` required is satisfied.
// Synchronous, arity-0 hook (no `next`): behaves identically across Mongoose
// 4..9. (StaffInvitation uses the `(next)` callback idiom; this is the same
// logic in the version-robust form.)
clinicMembershipInviteSchema.pre("validate", function preValidate() {
  if (this.isModified("emailEncrypted") && this.emailEncrypted) {
    const plain = isEncrypted(this.emailEncrypted)
      ? decryptValue(this.emailEncrypted)
      : this.emailEncrypted;
    if (plain) {
      this.emailHash = sha256(normalizeEmail(plain));
    }
    this.emailEncrypted = encryptValue(this.emailEncrypted);
  }
});

// Read decrypted email.
clinicMembershipInviteSchema.methods.getEmail = function getEmail() {
  return decryptValue(this.emailEncrypted);
};

// Is this invite still usable right now?
clinicMembershipInviteSchema.methods.isUsable = function isUsable() {
  return (
    this.status === MEMBERSHIP_INVITE_STATUS.PENDING &&
    this.expiresAt instanceof Date &&
    this.expiresAt.getTime() > Date.now()
  );
};

// Find pending, not-expired invites.
clinicMembershipInviteSchema.statics.findActivePending =
  function findActivePending(filter = {}) {
    return this.find({
      ...filter,
      status: MEMBERSHIP_INVITE_STATUS.PENDING,
      expiresAt: { $gt: new Date() },
    });
  };

// Hide sensitive fields from JSON output.
clinicMembershipInviteSchema.set("toJSON", {
  transform: (_doc, ret) => {
    delete ret.emailEncrypted;
    delete ret.tokenHash;
    return ret;
  },
});

const ClinicMembershipInvite =
  mongoose.models.ClinicMembershipInvite ||
  mongoose.model("ClinicMembershipInvite", clinicMembershipInviteSchema);

export default ClinicMembershipInvite;
