// server/modules/clinic/clinic-rooms/models/clinicRoom.model.js
//
// ClinicRoom — a physical (or logical) room inside a clinic department.
//
// Model decisions (mirrors clinic-departments conventions):
//   1. Tenant-scoped: clinicId is required. The service ALWAYS filters
//      queries by clinicId (read from ALS tenantContext / passed as an
//      explicit arg), so rows never cross clinics. No plugin needed —
//      same approach as clinicDepartment.model.js.
//   2. NOT encrypted — a room name / floor / capacity is not PHI.
//   3. departmentId is REQUIRED. Per the org plan, a room always belongs
//      to exactly one department ("Кабинет №12 принадлежит отделению
//      неврологии"). The service validates it against the clinic's ACTIVE
//      departments via assertDepartmentInClinic before save.
//   4. assignedMembershipIds: array of ClinicMembership ids — the doctors
//      (or staff) who work in this room. Used later by the scheduler.
//      The service validates each id belongs to this clinic.
//   5. code: optional, uppercased, UNIQUE PER CLINIC via a partial unique
//      index (only enforced when code is a non-empty string), same pattern
//      as clinicDepartment.code.
//   6. status: active | archived (soft lifecycle). Archived rooms are
//      hidden from pickers but kept for historical references.
//   7. mongoose.models.X || mongoose.model(...) guard prevents
//      OverwriteModelError on hot-reload / repeated imports.
//
// Indexes are declared with schema.index() AFTER field definitions so we
// never reference a field that doesn't exist (which throws on import).

import mongoose from "mongoose";

const { Schema } = mongoose;

export const ROOM_STATUSES = ["active", "archived"];

const clinicRoomSchema = new Schema(
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

    // ─── Identity ───
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },
    code: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 32,
      default: null,
    },

    // ─── Optional descriptive fields ───
    floor: {
      type: String,
      trim: true,
      maxlength: 50,
      default: null,
    },
    capacity: {
      type: Number,
      min: 0,
      max: 10000,
      default: null,
    },
    notes: {
      type: String,
      trim: true,
      maxlength: 2000,
      default: null,
    },

    // ─── Assigned staff (ClinicMembership ids) ───
    assignedMembershipIds: {
      type: [{ type: Schema.Types.ObjectId, ref: "ClinicMembership" }],
      default: [],
    },

    // ─── Lifecycle ───
    status: {
      type: String,
      enum: ROOM_STATUSES,
      default: "active",
      index: true,
    },

    // ─── Audit ───
    createdBy: { type: Schema.Types.ObjectId, default: null },
    lastUpdatedBy: { type: Schema.Types.ObjectId, default: null },
  },
  { timestamps: true },
);

// ─── Indexes ───
// Unique room code per clinic, but ONLY when code is a non-empty string.
// partialFilterExpression keeps null/missing codes out of the unique
// constraint so multiple rooms can have no code.
clinicRoomSchema.index(
  { clinicId: 1, code: 1 },
  {
    unique: true,
    partialFilterExpression: {
      code: { $type: "string" },
    },
  },
);

// Common listing query: rooms of a department, by status.
clinicRoomSchema.index({ clinicId: 1, departmentId: 1, status: 1 });

const ClinicRoom =
  mongoose.models.ClinicRoom ||
  mongoose.model("ClinicRoom", clinicRoomSchema, "clinic_rooms");

export default ClinicRoom;
