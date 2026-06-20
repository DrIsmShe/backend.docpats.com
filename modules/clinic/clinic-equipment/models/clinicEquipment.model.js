// server/modules/clinic/clinic-equipment/models/clinicEquipment.model.js
//
// ClinicEquipment = a piece of equipment owned by a clinic.
//
// Design notes (mirrors clinicRoom.model.js):
//   1. Tenant-scoped: clinicId is required. The service ALWAYS filters
//      queries by clinicId, so rows never cross clinics. No plugin needed —
//      same approach as clinicDepartment / clinicRoom models.
//   2. Equipment ALWAYS belongs to a department (departmentId required).
//      It MAY also be assigned to a specific room (roomId optional) — e.g.
//      a fixed CT scanner lives in one room, while a portable ECG cart has
//      a department but no fixed room.
//   3. `status` carries the operational lifecycle AND the soft-delete state:
//      operational | maintenance | broken | decommissioned | archived.
//      archive = soft delete (hidden from the default list).

import mongoose from "mongoose";

const { Schema } = mongoose;

export const EQUIPMENT_STATUSES = [
  "operational",
  "maintenance",
  "broken",
  "decommissioned",
  "archived",
];

export const EQUIPMENT_CATEGORIES = [
  "diagnostic",
  "imaging",
  "surgical",
  "monitoring",
  "laboratory",
  "therapeutic",
  "sterilization",
  "life_support",
  "furniture",
  "it",
  "other",
];

const clinicEquipmentSchema = new Schema(
  {
    // ─── Tenant ───
    clinicId: {
      type: Schema.Types.ObjectId,
      ref: "Clinic",
      required: true,
      index: true,
    },

    // ─── Owning department (required) ───
    departmentId: {
      type: Schema.Types.ObjectId,
      ref: "ClinicDepartment",
      required: true,
      index: true,
    },

    // ─── Assigned room (optional) ───
    roomId: {
      type: Schema.Types.ObjectId,
      ref: "ClinicRoom",
      default: null,
      index: true,
    },

    // ─── Identity ───
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },

    // Inventory / asset number. Optional, but unique per clinic when present.
    inventoryNumber: {
      type: String,
      default: null,
      trim: true,
      uppercase: true,
      maxlength: 64,
    },

    category: {
      type: String,
      enum: EQUIPMENT_CATEGORIES,
      default: "other",
      index: true,
    },

    manufacturer: { type: String, trim: true, maxlength: 200, default: null },
    model: { type: String, trim: true, maxlength: 200, default: null },
    serialNumber: { type: String, trim: true, maxlength: 200, default: null },

    // ─── Lifecycle ───
    status: {
      type: String,
      enum: EQUIPMENT_STATUSES,
      default: "operational",
      index: true,
    },

    // ─── Dates (all optional) ───
    purchaseDate: { type: Date, default: null },
    warrantyUntil: { type: Date, default: null },
    lastServiceDate: { type: Date, default: null },
    nextServiceDate: { type: Date, default: null },

    // ─── Responsible staff ───
    assignedMembershipIds: [
      {
        type: Schema.Types.ObjectId,
        ref: "ClinicMembership",
      },
    ],

    notes: { type: String, trim: true, maxlength: 2000, default: null },

    // ─── Audit ───
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  {
    timestamps: true,
    collection: "clinic_equipment",
  },
);

// ─── Indexes ───
// Common listing queries.
clinicEquipmentSchema.index({ clinicId: 1, status: 1 });
clinicEquipmentSchema.index({ clinicId: 1, departmentId: 1 });
clinicEquipmentSchema.index({ clinicId: 1, roomId: 1 });
clinicEquipmentSchema.index({ clinicId: 1, category: 1 });
clinicEquipmentSchema.index({ clinicId: 1, assignedMembershipIds: 1 });
clinicEquipmentSchema.index({ clinicId: 1, departmentId: 1, status: 1 });
// "Maintenance due" queries.
clinicEquipmentSchema.index({ clinicId: 1, nextServiceDate: 1 });

// inventoryNumber is unique per clinic, but ONLY when it's a string
// (so multiple null/unset records are allowed).
clinicEquipmentSchema.index(
  { clinicId: 1, inventoryNumber: 1 },
  {
    unique: true,
    partialFilterExpression: {
      inventoryNumber: { $type: "string" },
    },
  },
);

const ClinicEquipment =
  mongoose.models.ClinicEquipment ||
  mongoose.model("ClinicEquipment", clinicEquipmentSchema, "clinic_equipment");

export default ClinicEquipment;
