// server/modules/clinic/clinic-pharmacy/models/supplier.model.js
//
// Supplier = a vendor the clinic buys stock from. Referenced by DrugBatch
// (supplierId) so a receipt can record where a lot came from, and read by the
// accountant (SUPPLIER: RO) for procurement reporting.
//
// Design notes (mirrors drugItem.model.js / lead.model.js):
//   1. Tenant-scoped: clinicId REQUIRED; service ALWAYS filters by it.
//   2. NON-PHI: vendor contact data, not patient data — nothing encrypted.
//   3. Soft archive via status (active|archived) — never hard-deleted, so
//      historical batches keep a valid supplierId reference.

import mongoose from "mongoose";

const SUPPLIER_STATUSES = ["active", "archived"];

const NAME_MAX = 300;
const CONTACT_MAX = 200;
const PHONE_MAX = 40;
const EMAIL_MAX = 200;
const ADDRESS_MAX = 500;
const TAXID_MAX = 60;
const NOTE_MAX = 1000;

const supplierSchema = new mongoose.Schema(
  {
    clinicId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Clinic",
      required: true,
      index: true,
    },

    name: { type: String, trim: true, required: true, maxlength: NAME_MAX },

    contactPerson: {
      type: String,
      trim: true,
      default: "",
      maxlength: CONTACT_MAX,
    },
    phone: { type: String, trim: true, default: "", maxlength: PHONE_MAX },
    email: { type: String, trim: true, default: "", maxlength: EMAIL_MAX },
    address: { type: String, trim: true, default: "", maxlength: ADDRESS_MAX },

    // Налоговый идентификатор поставщика (AZ: ВÖEN и т.п.).
    taxId: { type: String, trim: true, default: "", maxlength: TAXID_MAX },

    status: {
      type: String,
      enum: SUPPLIER_STATUSES,
      default: "active",
      required: true,
      index: true,
    },

    note: { type: String, trim: true, default: "", maxlength: NOTE_MAX },
  },
  { timestamps: true, collection: "clinic_suppliers" },
);

// ── INDEXES ────────────────────────────────────────────────
supplierSchema.index({ clinicId: 1, status: 1, name: 1 });

const Supplier =
  mongoose.models.Supplier || mongoose.model("Supplier", supplierSchema);

export const SUPPLIER_STATUS_VALUES = SUPPLIER_STATUSES;

export default Supplier;
