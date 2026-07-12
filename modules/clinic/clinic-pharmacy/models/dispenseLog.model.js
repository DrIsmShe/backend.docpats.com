// server/modules/clinic/clinic-pharmacy/models/dispenseLog.model.js
//
// DispenseLog = an APPEND-ONLY record of one dispense: a quantity of a drug
// leaving stock, drawn FEFO from one or more batches, going to one of three
// targets. It is the pharmacy's legal journal — never edited, never deleted
// (especially for controlled substances / ПКУ).
//
// Channels (target):
//   • "requisition" — fulfilling a department requisition line
//                     (requisitionId + requisitionItemId set; departmentId
//                      copied from the requisition for reporting).
//   • "patient"     — direct dispense to a patient (PHI link; optional
//                     prescriptionId). This is why dispensing is audited.
//   • "department"  — direct/emergency dispense to a department, no formal
//                     requisition (departmentId set).
//
// batches[] is a SNAPSHOT of what consumeFEFO() returned — which lots and how
// much left stock — so a batch recall or controlled-substance audit can trace
// exactly which серии reached whom.
//
// isControlled is SNAPSHOTTED (not populated) — the catalog flag may change
// later, but the journal must remember the state at dispense time.
//
// Design notes:
//   1. Tenant-scoped: clinicId REQUIRED; service ALWAYS filters by it.
//   2. PHI-adjacent when target="patient" — the dispense SERVICE writes an
//      audit entry (recordActionAsync) around every write.
//   3. target↔ref consistency is enforced in the service (compute/validate
//      before .create(), per the "required fires before pre-save" rule); the
//      document validate below is a defensive net, not the primary guard.
//   4. Append-only: no status, no update path. Corrections happen as a
//      separate reversing entry (future), never by editing a record.

import mongoose from "mongoose";

const DISPENSE_TARGETS = ["requisition", "patient", "department"];

const NOTE_MAX = 1000;

// Snapshot of one batch draw. _id off — it's a value, not an entity.
const dispenseBatchSchema = new mongoose.Schema(
  {
    batchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DrugBatch",
      required: true,
    },
    batchNo: { type: String, default: "" },
    expiryDate: { type: Date, default: null },
    qty: { type: Number, required: true, min: 1 }, // baseUnit taken from this lot
  },
  { _id: false },
);

const dispenseLogSchema = new mongoose.Schema(
  {
    clinicId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Clinic",
      required: true,
      index: true,
    },

    drugItemId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "DrugItem",
      required: true,
      index: true,
    },

    // Total dispensed in baseUnit (== Σ batches[].qty).
    qty: { type: Number, required: true, min: 1 },

    // Per-lot breakdown (FEFO snapshot).
    batches: { type: [dispenseBatchSchema], default: [] },

    // Snapshot of the controlled flag at dispense time (ПКУ reporting).
    isControlled: { type: Boolean, default: false, index: true },

    // ── channel ──
    target: {
      type: String,
      enum: DISPENSE_TARGETS,
      required: true,
    },

    // target = "requisition"
    requisitionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Requisition",
      default: null,
      index: true,
    },
    requisitionItemId: {
      type: mongoose.Schema.Types.ObjectId,
      default: null, // subdoc _id within Requisition.items
    },

    // target = "department"  (also copied from requisition when target=requisition)
    departmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Department",
      default: null,
      index: true,
    },

    // target = "patient"  (PHI link; verify ref name against clinic-patients)
    patientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ClinicPatient",
      default: null,
    },
    prescriptionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Prescription",
      default: null,
    },

    // Pharmacist who dispensed (set by service from context).
    dispensedByMembershipId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ClinicMembership",
      required: true,
    },
    dispensedAt: { type: Date, default: Date.now, index: true },

    note: { type: String, trim: true, default: "", maxlength: NOTE_MAX },
  },
  { timestamps: true, collection: "clinic_dispense_logs" },
);

// Defensive net for target↔ref consistency (primary guard is the service).
dispenseLogSchema.pre("validate", function preValidate(next) {
  if (this.target === "requisition" && !this.requisitionId) {
    return next(new Error("requisitionId required when target=requisition"));
  }
  if (this.target === "patient" && !this.patientId) {
    return next(new Error("patientId required when target=patient"));
  }
  if (this.target === "department" && !this.departmentId) {
    return next(new Error("departmentId required when target=department"));
  }
  return next();
});

// ── INDEXES ────────────────────────────────────────────────
// Period reports (п.5 aggregation): everything the clinic dispensed in a range.
dispenseLogSchema.index({ clinicId: 1, dispensedAt: -1 });
// Per-drug movement history.
dispenseLogSchema.index({ clinicId: 1, drugItemId: 1, dispensedAt: -1 });
// Controlled-substance (ПКУ) report.
dispenseLogSchema.index({ clinicId: 1, isControlled: 1, dispensedAt: -1 });
// Patient medication history (PHI).
dispenseLogSchema.index({ clinicId: 1, patientId: 1, dispensedAt: -1 });

const DispenseLog =
  mongoose.models.DispenseLog ||
  mongoose.model("DispenseLog", dispenseLogSchema);

export const DISPENSE_TARGET_VALUES = DISPENSE_TARGETS;

export default DispenseLog;
