// server/modules/clinic/clinic-knowledge/models/clinicKnowledgeArticle.model.js
//
// ClinicKnowledgeArticle = an internal knowledge-base document for a clinic
// (protocols, SOPs, onboarding guides, FAQs, policy texts, templates).
//
// Design notes (mirrors clinicRoom / clinicEquipment models):
//   1. Tenant-scoped: clinicId is required; the service ALWAYS filters by it.
//      No plugin — same approach as the other clinic-* modules.
//   2. NON-PHI: this is internal staff documentation, NOT patient data, so
//      nothing here is encrypted.
//   3. departmentId is OPTIONAL: an article may target a single department
//      or be clinic-wide (null).
//   4. `status` carries draft/published lifecycle + archived soft-delete.
//   5. `visibility` gates which staff tiers may read it (enforced by the
//      service / frontend, not by the DB).

import mongoose from "mongoose";

const { Schema } = mongoose;

export const KNOWLEDGE_STATUSES = ["draft", "published", "archived"];

export const KNOWLEDGE_CATEGORIES = [
  "protocol",
  "guideline",
  "sop", // standard operating procedure
  "onboarding",
  "faq",
  "policy",
  "template",
  "other",
];

// Who may read the article.
//   all      — every clinic member
//   clinical — clinical staff (doctor/nurse) + managers/admin/owner
//   admin    — managers/admin/owner only
export const KNOWLEDGE_VISIBILITIES = ["all", "clinical", "admin"];

const clinicKnowledgeArticleSchema = new Schema(
  {
    // ─── Tenant ───
    clinicId: {
      type: Schema.Types.ObjectId,
      ref: "Clinic",
      required: true,
      index: true,
    },

    // ─── Optional owning department (null = clinic-wide) ───
    departmentId: {
      type: Schema.Types.ObjectId,
      ref: "ClinicDepartment",
      default: null,
      index: true,
    },

    // ─── Content ───
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 300,
    },

    // Free-form body. Markdown is expected but not enforced.
    body: {
      type: String,
      default: "",
      maxlength: 100000,
    },

    // Short plain-text summary shown in lists.
    summary: {
      type: String,
      trim: true,
      maxlength: 500,
      default: null,
    },

    category: {
      type: String,
      enum: KNOWLEDGE_CATEGORIES,
      default: "other",
      index: true,
    },

    tags: {
      type: [String],
      default: [],
    },

    // ─── Access + lifecycle ───
    visibility: {
      type: String,
      enum: KNOWLEDGE_VISIBILITIES,
      default: "all",
      index: true,
    },

    status: {
      type: String,
      enum: KNOWLEDGE_STATUSES,
      default: "draft",
      index: true,
    },

    pinned: { type: Boolean, default: false },

    // Bumped on every content update — a lightweight revision counter.
    version: { type: Number, default: 1 },

    publishedAt: { type: Date, default: null },

    // ─── Audit ───
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  {
    timestamps: true,
    collection: "clinic_knowledge_articles",
  },
);

// ─── Indexes ───
clinicKnowledgeArticleSchema.index({ clinicId: 1, status: 1 });
clinicKnowledgeArticleSchema.index({ clinicId: 1, category: 1 });
clinicKnowledgeArticleSchema.index({ clinicId: 1, departmentId: 1 });
clinicKnowledgeArticleSchema.index({ clinicId: 1, visibility: 1 });
clinicKnowledgeArticleSchema.index({ clinicId: 1, tags: 1 });
// Pinned-first, newest-first listing.
clinicKnowledgeArticleSchema.index({ clinicId: 1, pinned: -1, updatedAt: -1 });
// Lightweight text search on title + summary.
clinicKnowledgeArticleSchema.index({ title: "text", summary: "text" });

const ClinicKnowledgeArticle =
  mongoose.models.ClinicKnowledgeArticle ||
  mongoose.model(
    "ClinicKnowledgeArticle",
    clinicKnowledgeArticleSchema,
    "clinic_knowledge_articles",
  );

export default ClinicKnowledgeArticle;
