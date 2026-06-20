// server/modules/clinic/clinic-consilium/models/consilium.model.js
//
// Consilium = a multi-doctor discussion of a clinical case.
//
// Design notes (mirrors the other clinic-* models):
//   1. Tenant-scoped: clinicId required; the service ALWAYS filters by it.
//   2. Metadata (title/description) is stored in PLAIN text so consilia can
//      be listed/searched — the same split the chat module uses (dialog
//      metadata plain, message bodies encrypted). The DISCUSSION itself
//      lives in ConsiliumMessage with an encrypted body. Creators are
//      advised to keep direct patient identifiers out of the title.
//   3. patientId is OPTIONAL (a consilium may be a general case discussion).
//   4. departmentId is OPTIONAL.
//   5. status: open | resolved | archived (archived = soft delete).
//   6. patientCanJoin: explicit door for the PATIENT into the video room.
//      A consilium is doctor-private by default — doctors deliberate without
//      the patient present. The patient is admitted to the live room ONLY when
//      a doctor flips this flag on (and only if patientId -> their account).
//      This is the gate; the patient list and the video service both read it.

import mongoose from "mongoose";

const { Schema } = mongoose;

export const CONSILIUM_STATUSES = ["open", "resolved", "archived"];

const consiliumSchema = new Schema(
  {
    clinicId: {
      type: Schema.Types.ObjectId,
      ref: "Clinic",
      required: true,
      index: true,
    },

    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 300,
    },

    // Initial framing of the case. Plain text (kept out of encryption so the
    // case can be browsed); avoid direct identifiers here.
    description: {
      type: String,
      default: "",
      maxlength: 5000,
    },

    // Optional patient the consilium concerns.
    patientId: {
      type: Schema.Types.ObjectId,
      ref: "ClinicPatient",
      default: null,
      index: true,
    },

    // Optional owning department.
    departmentId: {
      type: Schema.Types.ObjectId,
      ref: "ClinicDepartment",
      default: null,
      index: true,
    },

    // Membership that opened the consilium (optional).
    initiatorMembershipId: {
      type: Schema.Types.ObjectId,
      ref: "ClinicMembership",
      default: null,
    },

    // Invited participants.
    participantMembershipIds: [
      {
        type: Schema.Types.ObjectId,
        ref: "ClinicMembership",
      },
    ],

    status: {
      type: String,
      enum: CONSILIUM_STATUSES,
      default: "open",
      index: true,
    },

    // Explicit invite of the PATIENT into this consilium's video room.
    // Default false: the consilium is a private doctor discussion. A doctor
    // sets this true to let the linked patient join the live call. Toggling it
    // off again revokes access for any future join (an in-progress join is not
    // forcibly ended — that is a future enhancement if needed).
    patientCanJoin: {
      type: Boolean,
      default: false,
    },

    // Final decision text, set when the consilium is resolved. Plain text.
    conclusion: {
      type: String,
      default: null,
      maxlength: 5000,
    },

    resolvedAt: { type: Date, default: null },

    // Denormalized counter for list views (kept in sync by the service).
    messageCount: { type: Number, default: 0 },
    lastMessageAt: { type: Date, default: null },

    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  {
    timestamps: true,
    collection: "clinic_consilia",
  },
);

consiliumSchema.index({ clinicId: 1, status: 1 });
consiliumSchema.index({ clinicId: 1, patientId: 1 });
consiliumSchema.index({ clinicId: 1, departmentId: 1 });
consiliumSchema.index({ clinicId: 1, participantMembershipIds: 1 });
consiliumSchema.index({ clinicId: 1, status: 1, updatedAt: -1 });

// Patient-side list crosses tenants (resolved from their ClinicPatient cards),
// so the query is by patientId + patientCanJoin without a clinicId prefix.
consiliumSchema.index({ patientId: 1, patientCanJoin: 1 });

const Consilium =
  mongoose.models.Consilium ||
  mongoose.model("Consilium", consiliumSchema, "clinic_consilia");

export default Consilium;
