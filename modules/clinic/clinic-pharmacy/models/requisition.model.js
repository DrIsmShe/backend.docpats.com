// server/modules/clinic/clinic-pharmacy/models/requisition.model.js
//
// Requisition (заявка) = a department's request to the pharmacy for stock.
// A nurse (старшая медсестра отделения) creates it; a pharmacist fulfils it.
// This is the document at the centre of the flow:
//
//     nurse (department)  →  submitted requisition  →  pharmacist dispenses
//
// It records WHAT and HOW MUCH was requested vs dispensed — never which
// physical batches were used. Batch/FEFO consumption + the audit trail live in
// DispenseLog (п.4); when a pharmacist fulfils a line, the dispense service
// bumps this line's qtyDispensed and (if all lines are complete) flips status.
//
// Units: qtyRequested / qtyDispensed are in the DrugItem's baseUnit
// (tablet/ampoule/ml…), same canonical unit as DrugBatch. A nurse enters packs
// in the UI; the frontend converts (packs × unitsPerPack) before submitting.
// Keeping ONE unit in the model avoids the pack/base drift bug.
//
// Design notes (mirrors drugBatch.model.js / lead.model.js):
//   1. Tenant-scoped: clinicId REQUIRED; service ALWAYS filters by it.
//   2. NON-PHI: this is internal logistics, not patient data.
//   3. departmentId is REQUIRED — a requisition is BY a department. (Verify
//      the ref model name against your departments module — "Department" here;
//      the ref only affects populate, not create.)
//   4. No hard delete — nurse withdrawal is status "cancelled", pharmacist
//      decline is "rejected", so history/DispenseLog references stay valid.

import mongoose from "mongoose";

// draft               — nurse still editing, not visible to pharmacy
// submitted           — sent to pharmacy, awaiting fulfilment
// partially_dispensed — some lines/quantities given, not all
// dispensed           — fully fulfilled
// rejected            — pharmacist declined (rejectionReason set)
// cancelled           — nurse withdrew before/while pending
const REQ_STATUSES = [
  "draft",
  "submitted",
  "partially_dispensed",
  "dispensed",
  "rejected",
  "cancelled",
];

const REQ_PRIORITIES = ["normal", "urgent"];

const LINE_NOTE_MAX = 300;
const NOTE_MAX = 1000;
const REASON_MAX = 500;

// ── line item ──────────────────────────────────────────────
const requisitionItemSchema = new mongoose.Schema(
  {
    drugItemId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DrugItem",
      required: true,
    },
    // Requested amount, in baseUnit. > 0.
    qtyRequested: { type: Number, required: true, min: 1 },
    // Running total dispensed so far, in baseUnit. Updated by the dispense
    // service as fulfilments happen. Never exceeds qtyRequested.
    qtyDispensed: { type: Number, default: 0, min: 0 },
    note: { type: String, trim: true, default: "", maxlength: LINE_NOTE_MAX },
  },
  { _id: true },
);

const requisitionSchema = new mongoose.Schema(
  {
    clinicId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Clinic",
      required: true,
      index: true,
    },

    // Отделение, от имени которого подана заявка.
    departmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Department",
      required: true,
      index: true,
    },

    // Membership медсестры, создавшей заявку. Ставит сервис из контекста.
    requestedByMembershipId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ClinicMembership",
      required: true,
      index: true,
    },

    status: {
      type: String,
      enum: REQ_STATUSES,
      default: "draft",
      required: true,
      index: true,
    },

    priority: {
      type: String,
      enum: REQ_PRIORITIES,
      default: "normal",
    },

    items: {
      type: [requisitionItemSchema],
      default: [],
    },

    note: { type: String, trim: true, default: "", maxlength: NOTE_MAX },

    // Membership фармацевта, исполнившего/отклонившего заявку.
    handledByMembershipId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ClinicMembership",
      default: null,
    },
    handledAt: { type: Date, default: null },
    rejectionReason: {
      type: String,
      trim: true,
      default: "",
      maxlength: REASON_MAX,
    },

    // When the nurse pushed draft → submitted (для сортировки очереди аптеки).
    submittedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: "clinic_requisitions" },
);

// ── INDEXES ────────────────────────────────────────────────
// Pharmacist queue: open requisitions across the clinic by recency.
requisitionSchema.index({ clinicId: 1, status: 1, submittedAt: -1 });
// A department's own requisitions.
requisitionSchema.index({ clinicId: 1, departmentId: 1, createdAt: -1 });
// A nurse's own requisitions.
requisitionSchema.index({
  clinicId: 1,
  requestedByMembershipId: 1,
  createdAt: -1,
});

const Requisition =
  mongoose.models.Requisition ||
  mongoose.model("Requisition", requisitionSchema);

export const REQUISITION_STATUS_VALUES = REQ_STATUSES;
export const REQUISITION_PRIORITY_VALUES = REQ_PRIORITIES;

export default Requisition;
