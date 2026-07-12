// server/modules/clinic/clinic-pharmacy/models/drugBatch.model.js
//
// DrugBatch = a physical lot of a DrugItem that arrived on a single receipt:
// one batch/серия with its own expiry date and remaining quantity. The "how
// much and until when", as opposed to DrugItem's "what".
//
// Why batches are separate from the catalog item:
//   • The same drug arrives multiple times with DIFFERENT expiry dates.
//   • Dispensing must follow FEFO (First-Expired-First-Out): always draw down
//     the batch that expires soonest. That requires per-lot expiry + quantity.
//   • Stock of a DrugItem = Σ quantity of its active batches (computed, never
//     stored on DrugItem — avoids drift).
//
// Quantities are in the DrugItem's baseUnit (tablet/ampoule/ml…). A receipt in
// "packs" must be converted (packs × unitsPerPack) BEFORE a batch is created —
// that conversion lives in the service, not here.
//
// Design notes (mirrors drugItem.model.js / lead.model.js):
//   1. Tenant-scoped: clinicId REQUIRED; service ALWAYS filters by it.
//   2. NON-PHI: batch/supplier/cost data is inventory, not patient data.
//   3. quantity is MUTABLE: it decrements on dispense/write-off. initialQty
//      preserves the received amount for audit/reporting.
//   4. Soft lifecycle via status — batches are never hard-deleted, so
//      DispenseLog references stay valid. depleted/expired/written_off are
//      terminal-ish; the service flips them.

import mongoose from "mongoose";

// active        — has quantity, dispensable
// depleted      — quantity hit 0 through normal dispensing
// expired       — past expiryDate (excluded from FEFO; not dispensable)
// written_off   — removed by staff (брак/бой/порча) with a reason in a movement
const BATCH_STATUSES = ["active", "depleted", "expired", "written_off"];

const BATCH_NO_MAX = 120;
const NOTE_MAX = 1000;

const drugBatchSchema = new mongoose.Schema(
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

    // Номер серии/партии от производителя.
    batchNo: { type: String, trim: true, default: "", maxlength: BATCH_NO_MAX },

    // Срок годности. Required — партия без срока не должна попадать в FEFO.
    expiryDate: { type: Date, required: true, index: true },

    // Текущий остаток в baseUnit. Уменьшается при выдаче/списании.
    quantity: { type: Number, required: true, min: 0 },

    // Сколько поступило изначально (для аудита/отчёта прихода). Неизменно.
    initialQuantity: { type: Number, required: true, min: 0 },

    // Закупочная цена за baseUnit (для отчётов бухгалтеру). 0 = не указана.
    unitCost: { type: Number, default: 0, min: 0 },

    supplierId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Supplier",
      default: null,
    },

    receivedAt: { type: Date, default: Date.now, index: true },

    status: {
      type: String,
      enum: BATCH_STATUSES,
      default: "active",
      required: true,
      index: true,
    },

    note: { type: String, trim: true, default: "", maxlength: NOTE_MAX },
  },
  { timestamps: true, collection: "clinic_drug_batches" },
);

// ── INDEXES ────────────────────────────────────────────────
// FEFO lookup: active batches of a drug, soonest-expiring first.
drugBatchSchema.index({ clinicId: 1, drugItemId: 1, status: 1, expiryDate: 1 });
// Expiring-soon / expired report across the clinic.
drugBatchSchema.index({ clinicId: 1, status: 1, expiryDate: 1 });

const DrugBatch =
  mongoose.models.DrugBatch || mongoose.model("DrugBatch", drugBatchSchema);

export const DRUG_BATCH_STATUS_VALUES = BATCH_STATUSES;

export default DrugBatch;
