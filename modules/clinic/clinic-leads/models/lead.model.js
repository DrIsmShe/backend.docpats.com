// server/modules/clinic/clinic-leads/models/lead.model.js
//
// Lead = a contact request left by a visitor on a clinic's public vitrina
// (call-back request or a free-text message). It is the clinic's inbox of
// prospective patients — the manager works this list, moving each lead
// new -> in_progress -> closed.
//
// Design notes (mirrors clinicAnnouncement / clinicRoom models):
//   1. Tenant-scoped: clinicId is REQUIRED; the service ALWAYS filters by it.
//      No plugin — same manual approach as the other clinic-* modules.
//   2. NON-PHI: a prospect's name + phone is contact data, not patient medical
//      data, so nothing is encrypted (same stance as reviews). The lead becomes
//      PHI only if/when converted into a ClinicPatient — a separate flow.
//   3. Public write: created by an UNAUTHENTICATED visitor via
//      POST /api/v1/public/clinics/:slug/leads. The service resolves clinicId
//      from the slug; the client never sends a clinicId it could forge.
//   4. type: "callback" (name + phone only) or "message" (adds free text).
//   5. status: new | in_progress | closed — the manager's workflow.
//   6. source: where the lead came from. Only "vitrina" for now; kept as a
//      field so future channels (widget, phone, import) are additive.

import mongoose from "mongoose";

const LEAD_TYPES = ["callback", "message"];
const LEAD_STATUSES = ["new", "in_progress", "closed"];
const LEAD_SOURCES = ["vitrina"];

const NAME_MAX = 200;
const PHONE_MAX = 40;
const MESSAGE_MAX = 2000;

const leadSchema = new mongoose.Schema(
  {
    clinicId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Clinic",
      required: true,
      index: true,
    },

    name: { type: String, trim: true, required: true, maxlength: NAME_MAX },
    phone: { type: String, trim: true, required: true, maxlength: PHONE_MAX },
    message: { type: String, trim: true, default: "", maxlength: MESSAGE_MAX },

    type: {
      type: String,
      enum: LEAD_TYPES,
      default: "message",
      required: true,
    },

    status: {
      type: String,
      enum: LEAD_STATUSES,
      default: "new",
      required: true,
      index: true,
    },

    source: {
      type: String,
      enum: LEAD_SOURCES,
      default: "vitrina",
      required: true,
    },

    handledByMembershipId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ClinicMembership",
      default: null,
    },
    handledAt: { type: Date, default: null },

    note: { type: String, trim: true, default: "", maxlength: 1000 },
  },
  { timestamps: true, collection: "clinic_leads" },
);

// ── INDEXES ────────────────────────────────────────────────
leadSchema.index({ clinicId: 1, status: 1, createdAt: -1 });

const Lead = mongoose.models.Lead || mongoose.model("Lead", leadSchema);

export const LEAD_TYPE_VALUES = LEAD_TYPES;
export const LEAD_STATUS_VALUES = LEAD_STATUSES;
export const LEAD_SOURCE_VALUES = LEAD_SOURCES;

export default Lead;