// server/modules/clinic/clinic-staff/clinicMembership.model.js
//
// ClinicMembership = the link between a User and a Clinic with a specific role.
// One user can have multiple memberships (work in multiple clinics).
// Ending a membership = setting leftAt (NOT deleting), to preserve history.

import mongoose from "mongoose";
import { ROLES } from "../../../../common/auth/permissions.js";

const ALLOWED_ROLES = Object.values(ROLES);

const clinicMembershipSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    clinicId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Clinic",
      required: true,
      index: true,
    },

    role: {
      type: String,
      enum: ALLOWED_ROLES,
      required: true,
      index: true,
    },

    // Granular permission overrides on top of role defaults.
    // Map of { [resource]: { read, write, delete } }
    // If empty/undefined, role's default permissions apply.
    permissions: {
      type: Map,
      of: new mongoose.Schema(
        {
          read: { type: Boolean, default: false },
          write: { type: Boolean, default: false },
          delete: { type: Boolean, default: false },
        },
        { _id: false },
      ),
      default: undefined,
    },

    // Primary membership = where the user logs in by default
    isPrimary: { type: Boolean, default: false },

    // Active membership flags
    isActive: { type: Boolean, default: true },
    joinedAt: { type: Date, default: Date.now },
    leftAt: { type: Date, default: null }, // null = still working
    invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },

    // Employment metadata
    employmentType: {
      type: String,
      enum: ["fulltime", "parttime", "contract", "consultant", null],
      default: null,
    },
    customTitle: { type: String, trim: true, maxlength: 200 },

    // Discriminator: which collection holds the userId
    // - "user" (default): userId points to User collection (doctors/patients)
    // - "employee": userId points to ClinicEmployee collection (internal staff)
    // This lets clinicResolver and tenantMiddleware know which collection
    // to look up when resolving the actor's identity.
    actorType: {
      type: String,
      enum: ["user", "employee"],
      default: "user",
      index: true,
    },
  },
  {
    timestamps: true,
    collection: "clinic_memberships",
  },
);

// One active membership per (user, clinic).
// partialFilterExpression allows multiple records IF user re-joins after leaving.
clinicMembershipSchema.index(
  { userId: 1, clinicId: 1 },
  {
    unique: true,
    partialFilterExpression: { leftAt: null },
  },
);

// Used by clinicResolver to find user's primary clinic.
clinicMembershipSchema.index({ userId: 1, isPrimary: -1, leftAt: 1 });

// All members of a clinic, sorted by activity.
clinicMembershipSchema.index({ clinicId: 1, leftAt: 1, role: 1 });

const ClinicMembership =
  mongoose.models.ClinicMembership ||
  mongoose.model("ClinicMembership", clinicMembershipSchema);

export default ClinicMembership;
