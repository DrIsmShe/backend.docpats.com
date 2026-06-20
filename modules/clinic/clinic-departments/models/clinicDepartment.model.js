// server/modules/clinic/clinic-departments/models/clinicDepartment.model.js

import mongoose from "mongoose";

const { Schema, model, Types } = mongoose;

// Comprehensive list of clinical specialties at the department level.
// Grouped logically; flat enum for validation. "general" first, "other"
// last. Keys are stable snake_case identifiers — labels come from i18n
// (departments.specialty.<key>). DO NOT rename/remove existing keys
// (breaks stored data); append only.
export const DEPARTMENT_SPECIALTIES = [
  // General / primary care
  "general",
  "family_medicine",
  "internal_medicine",
  "therapy",
  "pediatrics",
  "neonatology",
  "geriatrics",
  // Emergency / critical care
  "emergency_medicine",
  "intensive_care",
  "anesthesiology",
  // Cardiovascular
  "cardiology",
  "cardiac_surgery",
  "vascular_surgery",
  "thoracic_surgery",
  "phlebology",
  // Neuro
  "neurology",
  "neurosurgery",
  // Mental health
  "psychiatry",
  "psychology",
  "psychotherapy",
  "addiction_medicine",
  // GI / metabolic / nutrition
  "gastroenterology",
  "hepatology",
  "endocrinology",
  "nutrition",
  // Renal / urinary / reproductive
  "nephrology",
  "urology",
  "andrology",
  "gynecology",
  "obstetrics",
  "reproductive_medicine",
  "mammology",
  // Respiratory
  "pulmonology",
  // Musculoskeletal / rheumatology
  "rheumatology",
  "orthopedics",
  "traumatology",
  "sports_medicine",
  // Blood / oncology / immunology
  "hematology",
  "oncology",
  "radiation_oncology",
  "immunology",
  "allergology",
  "transfusion_medicine",
  // Infectious disease
  "infectious_diseases",
  // Skin / aesthetics
  "dermatology",
  "venereology",
  "cosmetology",
  "plastic_surgery",
  // Head & neck / senses
  "ent",
  "audiology",
  "ophthalmology",
  // Surgery
  "surgery",
  "pediatric_surgery",
  "proctology",
  "transplantology",
  // Dental / maxillofacial
  "dentistry",
  "orthodontics",
  "maxillofacial_surgery",
  // Diagnostics
  "radiology",
  "nuclear_medicine",
  "pathology",
  "laboratory_medicine",
  "microbiology",
  "genetics",
  // Rehabilitation / pain / palliative
  "rehabilitation",
  "physiotherapy",
  "pain_medicine",
  "palliative_care",
  // Public / occupational / forensic
  "occupational_medicine",
  "preventive_medicine",
  "forensic_medicine",
  // Catch-all
  "other",
];

const clinicDepartmentSchema = new Schema(
  {
    // ── Tenant ──────────────────────────────────────────────
    clinicId: {
      type: Types.ObjectId,
      ref: "Clinic",
      required: true,
    },

    // Optional binding to a specific branch (physical/virtual).
    // null = department exists at clinic level across all branches.
    branchId: {
      type: Types.ObjectId,
      ref: "ClinicBranch",
      default: null,
    },

    // ── Identity ────────────────────────────────────────────
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 200,
    },

    // Short human code (e.g. "NEURO", "ENT"). Optional, unique per clinic.
    code: {
      type: String,
      trim: true,
      uppercase: true,
      maxlength: 32,
      default: null,
    },

    specialty: {
      type: String,
      enum: DEPARTMENT_SPECIALTIES,
      default: "general",
    },

    description: {
      type: String,
      trim: true,
      maxlength: 2000,
      default: "",
    },

    // ── Org structure ───────────────────────────────────────
    // Department head — a ClinicMembership (the "заведующий отделением").
    headMembershipId: {
      type: Types.ObjectId,
      ref: "ClinicMembership",
      default: null,
    },

    // Self-reference for sub-departments (optional, supports nesting).
    parentDepartmentId: {
      type: Types.ObjectId,
      ref: "ClinicDepartment",
      default: null,
    },

    // ── System flags ────────────────────────────────────────
    // true for the auto-created "General" department on clinic setup.
    isSystem: {
      type: Boolean,
      default: false,
    },

    status: {
      type: String,
      enum: ["active", "archived"],
      default: "active",
    },
  },
  { timestamps: true },
);

// ── Indexes (declared once here to avoid duplicate-index warnings) ──
clinicDepartmentSchema.index({ clinicId: 1, status: 1 });
clinicDepartmentSchema.index({ clinicId: 1, branchId: 1 });
clinicDepartmentSchema.index({ clinicId: 1, parentDepartmentId: 1 });

// Code unique within a clinic, but only enforced when code is set.
clinicDepartmentSchema.index(
  { clinicId: 1, code: 1 },
  {
    unique: true,
    partialFilterExpression: { code: { $type: "string" } },
  },
);

export const ClinicDepartment = model(
  "ClinicDepartment",
  clinicDepartmentSchema,
);

export default ClinicDepartment;
