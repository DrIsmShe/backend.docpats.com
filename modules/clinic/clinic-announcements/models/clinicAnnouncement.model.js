// server/modules/clinic/clinic-announcements/models/clinicAnnouncement.model.js
//
// ClinicAnnouncement = an internal corporate-portal announcement for a clinic
// ("В понедельник собрание", policy notices, shift changes, kudos…).
//
// Mental model: a lightweight bulletin board, NOT a social feed. The head
// physician / admin posts; every clinic member sees it; we track who has read
// it (read-receipt) so the author knows the reach.
//
// Design notes (mirrors clinicKnowledgeArticle / clinicRoom models):
//   1. Tenant-scoped: clinicId is REQUIRED; the service ALWAYS filters by it.
//      No plugin — same approach as the other clinic-* modules.
//   2. NON-PHI: staff communication, not patient data → nothing encrypted.
//   3. Author & readers are identified by ClinicMembership._id — the ONE id
//      that is uniform across BOTH doctors (actorType "user") and internal
//      staff (actorType "employee"). See clinicMembership.model.js: a
//      membership exists for every clinic member regardless of actor kind.
//   4. audience: "all" (whole clinic) or "department" (departmentId required).
//   5. readBy: append-only set of { membershipId, at } — drives read-receipts.
//   6. comments[]: reserved for a future phase (B). Shipped empty; the list
//      page does not render them yet. Kept here so enabling comments later is
//      a pure additive change (no migration).
//   7. status: published | archived. No draft for MVP — posting is the act.

import mongoose from "mongoose";

const ANNOUNCEMENT_STATUSES = ["published", "archived"];
const ANNOUNCEMENT_AUDIENCES = ["all", "department"];

// ── Read receipt entry ───────────────────────────────────────────
const readReceiptSchema = new mongoose.Schema(
  {
    membershipId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ClinicMembership",
      required: true,
    },
    at: { type: Date, default: Date.now },
  },
  { _id: false },
);

// ── Comment (reserved for Phase B — not surfaced in MVP UI) ──────
const announcementCommentSchema = new mongoose.Schema(
  {
    authorMembershipId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ClinicMembership",
      required: true,
    },
    body: { type: String, trim: true, required: true, maxlength: 4000 },
    createdAt: { type: Date, default: Date.now },
  },
  { _id: true },
);

const clinicAnnouncementSchema = new mongoose.Schema(
  {
    clinicId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Clinic",
      required: true,
      index: true,
    },

    // Author — always a ClinicMembership (uniform for user & employee actors).
    authorMembershipId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ClinicMembership",
      required: true,
    },
    // Denormalized author display name, captured at post time (cheap list
    // render without populate; membership/profile may change later).
    authorName: { type: String, trim: true, default: "" },

    title: { type: String, trim: true, required: true, maxlength: 300 },
    body: { type: String, trim: true, required: true, maxlength: 20000 },

    // Targeting.
    audience: {
      type: String,
      enum: ANNOUNCEMENT_AUDIENCES,
      default: "all",
      required: true,
    },
    departmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ClinicDepartment",
      default: null,
    },

    pinned: { type: Boolean, default: false },

    status: {
      type: String,
      enum: ANNOUNCEMENT_STATUSES,
      default: "published",
      required: true,
      index: true,
    },

    // Read-receipts (append-only). One entry per membership that opened it.
    readBy: { type: [readReceiptSchema], default: [] },

    // Reserved for Phase B. Empty in MVP.
    comments: { type: [announcementCommentSchema], default: [] },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ClinicMembership",
      default: null,
    },
  },
  { timestamps: true },
);

// ── INDEXES ──────────────────────────────────────────────────────
// Main list query: clinic feed, pinned first then newest.
clinicAnnouncementSchema.index({
  clinicId: 1,
  status: 1,
  pinned: -1,
  createdAt: -1,
});
// Department-scoped feed.
clinicAnnouncementSchema.index({ clinicId: 1, departmentId: 1, createdAt: -1 });

// ── VALIDATION ───────────────────────────────────────────────────
clinicAnnouncementSchema.pre("validate", function (next) {
  if (this.audience === "department" && !this.departmentId) {
    return next(
      new Error("departmentId is required when audience is 'department'."),
    );
  }
  if (this.audience === "all") {
    // Normalize: clinic-wide announcements carry no department.
    this.departmentId = null;
  }
  next();
});

// OverwriteModelError guard — project standard.
const ClinicAnnouncement =
  mongoose.models.ClinicAnnouncement ||
  mongoose.model("ClinicAnnouncement", clinicAnnouncementSchema);

export const ANNOUNCEMENT_STATUS_VALUES = ANNOUNCEMENT_STATUSES;
export const ANNOUNCEMENT_AUDIENCE_VALUES = ANNOUNCEMENT_AUDIENCES;

export default ClinicAnnouncement;
