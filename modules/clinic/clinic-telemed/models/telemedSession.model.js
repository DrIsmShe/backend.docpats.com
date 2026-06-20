// server/modules/clinic/clinic-telemed/models/telemedSession.model.js
//
// TelemedSession = a scheduled virtual (video) consultation.
//
// Design notes (mirrors the other clinic-* models):
//   1. Tenant-scoped: clinicId required; the service ALWAYS filters by it.
//   2. This module is a SCHEDULING + LIFECYCLE layer. The actual video call
//      is handled by the existing call infrastructure; this session simply
//      carries an opaque `joinKey` that the call layer can use as a room id.
//   3. Metadata mirrors the appointment convention (patient/staff links stored
//      plainly, clinic-scoped) — NOT encrypted. Keep direct identifiers out of
//      `title`. Post-visit `notes` are short and plain; sensitive clinical
//      detail belongs in the patient's medical record, not here.
//   4. status lifecycle:
//        scheduled → live → completed
//        scheduled → cancelled
//        scheduled → no_show

import mongoose from "mongoose";

const { Schema } = mongoose;

export const TELEMED_STATUSES = [
  "scheduled",
  "live",
  "completed",
  "cancelled",
  "no_show",
];

const telemedSessionSchema = new Schema(
  {
    clinicId: {
      type: Schema.Types.ObjectId,
      ref: "Clinic",
      required: true,
      index: true,
    },

    // The patient the visit is for (optional at the model level; the frontend
    // requires it). Stored as-is; reads are clinic-scoped.
    patientId: {
      type: Schema.Types.ObjectId,
      ref: "ClinicPatient",
      default: null,
      index: true,
    },

    // Hosting clinician (optional ref to a membership).
    hostMembershipId: {
      type: Schema.Types.ObjectId,
      ref: "ClinicMembership",
      default: null,
      index: true,
    },

    departmentId: {
      type: Schema.Types.ObjectId,
      ref: "ClinicDepartment",
      default: null,
      index: true,
    },

    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 300,
    },

    scheduledAt: {
      type: Date,
      required: true,
      index: true,
    },

    durationMinutes: {
      type: Number,
      default: 30,
      min: 5,
      max: 480,
    },

    status: {
      type: String,
      enum: TELEMED_STATUSES,
      default: "scheduled",
      index: true,
    },

    // Opaque room/join token consumed by the existing call layer.
    joinKey: {
      type: String,
      required: true,
    },

    startedAt: { type: Date, default: null },
    endedAt: { type: Date, default: null },

    // ─── Video mode (layered) ───
    // Variant 3: an external meeting link (Jitsi / Meet / Whereby / Zoom).
    // When set, "Join" simply opens this URL — no WebRTC needed.
    meetingUrl: { type: String, trim: true, maxlength: 1000, default: null },

    // Variant 1 (P2P over the existing chat-call gateway): the registered
    // DocPats user id of the patient, if any. Stored so "Join" can place a
    // call:initiate to this user. Optional — many clinic patients are not
    // registered users; in that case fall back to meetingUrl (Variant 3) or
    // the joinKey room mode (Variant 2).
    patientUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    notes: { type: String, trim: true, maxlength: 2000, default: null },

    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  {
    timestamps: true,
    collection: "clinic_telemed_sessions",
  },
);

telemedSessionSchema.index({ clinicId: 1, status: 1 });
telemedSessionSchema.index({ clinicId: 1, scheduledAt: 1 });
telemedSessionSchema.index({
  clinicId: 1,
  hostMembershipId: 1,
  scheduledAt: 1,
});
telemedSessionSchema.index({ clinicId: 1, patientId: 1, scheduledAt: 1 });
// joinKey unique per clinic (always a string, so a plain unique compound index).
telemedSessionSchema.index({ clinicId: 1, joinKey: 1 }, { unique: true });

const TelemedSession =
  mongoose.models.TelemedSession ||
  mongoose.model(
    "TelemedSession",
    telemedSessionSchema,
    "clinic_telemed_sessions",
  );

export default TelemedSession;
