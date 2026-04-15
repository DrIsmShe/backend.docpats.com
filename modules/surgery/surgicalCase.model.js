import mongoose from "mongoose";

const { Schema, model } = mongoose;

const PhotoRefSchema = new Schema(
  {
    filename: { type: String, required: true },
    originalName: { type: String },
    label: {
      type: String,
      enum: [
        "before",
        "after",
        "intra_op",
        "1week",
        "1month",
        "3months",
        "6months",
        "simulation",
      ],
      default: "before",
    },
    takenAt: { type: Date, default: Date.now },
    isPublic: { type: Boolean, default: false },
    mimetype: { type: String },
    size: { type: Number },
  },
  { _id: true },
);

const FollowUpSchema = new Schema(
  {
    date: { type: Date, required: true },
    notesEncrypted: { type: String },
    complications: { type: String, default: "" },
    photos: [{ type: Schema.Types.ObjectId }],
    addedBy: { type: String, enum: ["surgeon", "patient"], default: "surgeon" },
  },
  { _id: true },
);

const SurgicalCaseSchema = new Schema(
  {
    // ─── Хирург ─────────────────────────────────────────────────────────────
    surgeonId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    // ─── Пациент — полиморфная связь ────────────────────────────────────────
    // patientType определяет с какой моделью работаем
    patientType: {
      type: String,
      enum: ["registered", "private", "anonymous"],
      default: "anonymous",
      index: true,
    },

    // Зарегистрированный пациент (NewPatientPolyclinic)
    registeredPatientId: {
      type: Schema.Types.ObjectId,
      ref: "NewPatientPolyclinic",
      default: null,
      index: true,
    },

    // Приватный пациент доктора (DoctorPrivatePatient)
    privatePatientId: {
      type: Schema.Types.ObjectId,
      ref: "DoctorPrivatePatient",
      default: null,
      index: true,
    },

    // Анонимный код (если хирург не хочет привязывать к пациенту из CRM)
    patientIdHash: {
      type: String,
      default: "",
    },

    consentGiven: { type: Boolean, default: false },
    consentDate: { type: Date },

    // ─── Тип операции ───────────────────────────────────────────────────────
    procedure: {
      type: String,
      required: true,
      enum: [
        "rhinoplasty",
        "blepharoplasty",
        "facelift",
        "brow_lift",
        "otoplasty",
        "chin_implant",
        "cheek_implant",
        "lip_augmentation",
        "lip_lift",
        "neck_lift",
        "fat_grafting_face",
        "ear_reconstruction",
        "breast_augmentation",
        "breast_reduction",
        "breast_lift",
        "breast_reconstruction",
        "abdominoplasty",
        "liposuction",
        "bbl",
        "body_contouring",
        "arm_lift",
        "thigh_lift",
        "lower_body_lift",
        "gynecomastia",
        "labiaplasty",
        "vaginoplasty",
        "appendectomy",
        "cholecystectomy",
        "hernia_repair",
        "gastrectomy",
        "colectomy",
        "splenectomy",
        "bowel_resection",
        "liver_resection",
        "pancreatic_surgery",
        "rectal_surgery",
        "stoma_formation",
        "bariatric_sleeve",
        "bariatric_bypass",
        "bariatric_band",
        "cabg",
        "valve_replacement",
        "valve_repair",
        "aortic_surgery",
        "pacemaker",
        "icd_implant",
        "heart_transplant",
        "atrial_repair",
        "vad_implant",
        "pericardectomy",
        "aaa_repair",
        "carotid_endarterectomy",
        "bypass_peripheral",
        "varicose_veins",
        "av_fistula",
        "embolectomy",
        "angioplasty",
        "amputation",
        "craniotomy",
        "brain_tumor",
        "spine_discectomy",
        "spine_fusion",
        "laminectomy",
        "vp_shunt",
        "dbs",
        "aneurysm_clipping",
        "carpal_tunnel",
        "peripheral_nerve",
        "lobectomy",
        "pneumonectomy",
        "wedge_resection",
        "thymectomy",
        "esophagectomy",
        "pleurectomy",
        "lung_transplant",
        "chest_wall_repair",
        "hip_replacement",
        "knee_replacement",
        "shoulder_replacement",
        "acl_repair",
        "meniscus_repair",
        "fracture_fixation",
        "arthroscopy",
        "spinal_deformity",
        "bone_tumor",
        "tendon_repair",
        "foot_surgery",
        "hand_surgery",
        "prostatectomy",
        "nephrectomy",
        "kidney_transplant",
        "ureteroscopy",
        "pcnl",
        "bladder_surgery",
        "cystectomy",
        "orchiectomy",
        "varicocele",
        "circumcision",
        "penile_implant",
        "sling_procedure",
        "hysterectomy",
        "myomectomy",
        "ovarian_cyst",
        "oophorectomy",
        "laparoscopy_gyn",
        "endometriosis",
        "tubal_ligation",
        "cesarean",
        "prolapse_repair",
        "cervical_conization",
        "cataract",
        "lasik",
        "glaucoma_surgery",
        "retinal_detachment",
        "vitrectomy",
        "strabismus",
        "corneal_transplant",
        "pterygium",
        "tonsillectomy",
        "adenoidectomy",
        "septoplasty",
        "sinus_surgery",
        "tympanoplasty",
        "cochlear_implant",
        "laryngoscopy",
        "parotidectomy",
        "thyroidectomy",
        "parathyroidectomy",
        "mastectomy",
        "sentinel_node",
        "lymphadenectomy",
        "tumor_excision",
        "cytoreductive",
        "hipec",
        "exenteration",
        "port_implant",
        "liver_transplant",
        "pancreas_transplant",
        "bone_marrow_transplant",
        "cornea_transplant",
        "hand_transplant",
        "face_transplant",
        "pyloric_stenosis",
        "intussusception",
        "hirschsprung",
        "cleft_lip_palate",
        "hypospadias",
        "undescended_testis",
        "vsd_asd_repair",
        "dialysis_access",
        "wound_debridement",
        "abscess_drainage",
        "circumcision_adult",
        "pilonidal_cyst",
        "hemorrhoidectomy",
        "fistula_repair",
        "skin_graft",
        "other",
      ],
      index: true,
    },

    status: {
      type: String,
      enum: ["planned", "completed", "follow_up", "closed"],
      default: "planned",
      index: true,
    },

    operationDate: { type: Date, index: true },

    // ─── Операционный план (шифруется) ──────────────────────────────────────
    planEncrypted: { type: String },

    // ─── Технические параметры ──────────────────────────────────────────────
    metrics: {
      technique: { type: String },
      implantSize: { type: String },
      implantType: { type: String },
      volume: { type: String },
      duration: { type: Number },
      anesthesia: { type: String, enum: ["local", "general", "sedation", ""] },
      customFields: { type: Map, of: String },
    },

    photos: [PhotoRefSchema],
    simulations: [
      {
        sourcePhotoId: { type: Schema.Types.ObjectId },
        prompt: { type: String },
        resultFiles: [{ type: String }],
        selectedIdx: { type: Number, default: 0 },
        status: {
          type: String,
          enum: ["pending", "done", "failed"],
          default: "pending",
        },
        createdAt: { type: Date, default: Date.now },
        disclaimer: { type: Boolean, default: false },
      },
    ],

    outcomeScore: { type: Number, min: 1, max: 10 },
    followUps: [FollowUpSchema],

    isPublic: { type: Boolean, default: false, index: true },
    publishedAt: { type: Date },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

SurgicalCaseSchema.index({ surgeonId: 1, status: 1 });
SurgicalCaseSchema.index({ surgeonId: 1, procedure: 1 });
SurgicalCaseSchema.index({ isPublic: 1, procedure: 1 });
SurgicalCaseSchema.index({ deletedAt: 1 });
SurgicalCaseSchema.index({ surgeonId: 1, registeredPatientId: 1 });
SurgicalCaseSchema.index({ surgeonId: 1, privatePatientId: 1 });

SurgicalCaseSchema.virtual("photoCount").get(function () {
  return this.photos?.length ?? 0;
});

SurgicalCaseSchema.methods.toPublicView = function () {
  return {
    _id: this._id,
    procedure: this.procedure,
    operationDate: this.operationDate,
    outcomeScore: this.outcomeScore,
    metrics: {
      technique: this.metrics?.technique,
      implantSize: this.metrics?.implantSize,
      implantType: this.metrics?.implantType,
      anesthesia: this.metrics?.anesthesia,
    },
    photos: this.photos
      .filter((p) => p.isPublic)
      .map((p) => ({ _id: p._id, label: p.label, filename: p.filename })),
    createdAt: this.createdAt,
  };
};

export default model("SurgicalCase", SurgicalCaseSchema);
