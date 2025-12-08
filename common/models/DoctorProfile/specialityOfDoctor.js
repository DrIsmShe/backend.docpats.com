import mongoose from "mongoose";

const specializationSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true }, // Specialization name
    category: { type: String, required: true }, // Category
    subcategories: [{ type: String }], // Subcategories
    description: { type: String }, // Specialization description

    // Relations with other entities
    relatedDoctors: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
    relatedPatients: [{ type: mongoose.Schema.Types.ObjectId, ref: "Patient" }],
    relatedClinics: [{ type: mongoose.Schema.Types.ObjectId, ref: "Clinic" }],
    relatedArticles: [{ type: mongoose.Schema.Types.ObjectId, ref: "Article" }],
    relatedBooks: [{ type: mongoose.Schema.Types.ObjectId, ref: "Book" }],
    relatedMovies: [{ type: mongoose.Schema.Types.ObjectId, ref: "Movie" }],
    relatedComments: [{ type: mongoose.Schema.Types.ObjectId, ref: "Comment" }],
    relatedNotifications: [
      { type: mongoose.Schema.Types.ObjectId, ref: "Notification" },
    ],
    relatedFiles: [{ type: mongoose.Schema.Types.ObjectId, ref: "File" }],
    relatedOperations: [
      { type: mongoose.Schema.Types.ObjectId, ref: "Operation" },
    ],
    relatedDiagnoses: [
      { type: mongoose.Schema.Types.ObjectId, ref: "Diagnosis" },
    ],
  },
  { timestamps: true }
);

const Specialization = mongoose.model("Specialization", specializationSchema);
export default Specialization;

// Full list of specializations
export const SPECIALIZATIONS = [
  { name: "Therapist", category: "Therapeutic Specialties", subcategories: [] },
  {
    name: "Family Doctor",
    category: "Therapeutic Specialties",
    subcategories: [],
  },
  {
    name: "Gastroenterologist",
    category: "Therapeutic Specialties",
    subcategories: [],
  },
  {
    name: "Cardiologist",
    category: "Therapeutic Specialties",
    subcategories: [],
  },
  {
    name: "Interventional Cardiologist",
    category: "Therapeutic Specialties",
    subcategories: [],
  },
  {
    name: "Pediatric Cardiologist",
    category: "Therapeutic Specialties",
    subcategories: [],
  },
  {
    name: "Pulmonologist",
    category: "Therapeutic Specialties",
    subcategories: [],
  },
  {
    name: "Nephrologist",
    category: "Therapeutic Specialties",
    subcategories: [],
  },
  {
    name: "Hematologist",
    category: "Therapeutic Specialties",
    subcategories: [],
  },
  {
    name: "Endocrinologist",
    category: "Therapeutic Specialties",
    subcategories: [],
  },
  {
    name: "Rheumatologist",
    category: "Therapeutic Specialties",
    subcategories: [],
  },
  {
    name: "Allergist-Immunologist",
    category: "Therapeutic Specialties",
    subcategories: [],
  },
  {
    name: "Infectious Disease Specialist",
    category: "Therapeutic Specialties",
    subcategories: [],
  },
  {
    name: "Phthisiatrician",
    category: "Therapeutic Specialties",
    subcategories: [],
  },
  {
    name: "Hepatologist",
    category: "Therapeutic Specialties",
    subcategories: [],
  },
  { name: "Dietitian", category: "Therapeutic Specialties", subcategories: [] },
  { name: "Urologist", category: "Therapeutic Specialties", subcategories: [] },
  {
    name: "Dermatologist",
    category: "Therapeutic Specialties",
    subcategories: [],
  },
  {
    name: "Occupational Medicine Doctor",
    category: "Therapeutic Specialties",
    subcategories: [],
  },
  {
    name: "Pain Management Specialist",
    category: "Therapeutic Specialties",
    subcategories: [],
  },

  { name: "Pediatrician", category: "Pediatrics", subcategories: [] },
  { name: "Neonatologist", category: "Pediatrics", subcategories: [] },
  { name: "Child Psychiatrist", category: "Pediatrics", subcategories: [] },

  { name: "Gynecologist", category: "Women’s Health", subcategories: [] },
  { name: "Obstetrician", category: "Women’s Health", subcategories: [] },
  {
    name: "Reproductive Endocrinologist",
    category: "Women’s Health",
    subcategories: [],
  },

  { name: "Andrologist", category: "Men’s Health", subcategories: [] },

  { name: "Neurosurgeon", category: "Surgical Specialties", subcategories: [] },

  {
    name: "Orthopedic Trauma Surgeon",
    category: "Surgical Specialties",
    subcategories: [],
  },
  {
    name: "Maxillofacial Surgeon",
    category: "Surgical Specialties",
    subcategories: [],
  },
  {
    name: "Cardiac Surgeon",
    category: "Surgical Specialties",
    subcategories: [],
  },

  {
    name: "Thoracic Surgeon",
    category: "Surgical Specialties",
    subcategories: [],
  },
  {
    name: "Abdominal Surgeon",
    category: "Surgical Specialties",
    subcategories: [],
  },
  {
    name: "Coloproctologist",
    category: "Surgical Specialties",
    subcategories: [],
  },
  {
    name: "Endocrine Surgeon",
    category: "Surgical Specialties",
    subcategories: [],
  },
  {
    name: "Plastic Surgeon",
    category: "Surgical Specialties",
    subcategories: [],
  },
  {
    name: "Purulent Surgeon",
    category: "Surgical Specialties",
    subcategories: [],
  },
  {
    name: "Vascular Surgeon",
    category: "Surgical Specialties",
    subcategories: [],
  },
  {
    name: "Transplant Surgeon",
    category: "Surgical Specialties",
    subcategories: [],
  },
  { name: "Oral Surgeon", category: "Surgical Specialties", subcategories: [] },

  {
    name: "Ophthalmologist",
    category: "Ophthalmology and ENT",
    subcategories: ["Retinologist"],
  },
  {
    name: "Otolaryngologist",
    category: "Ophthalmology and ENT",
    subcategories: ["Audiologist", "Phoniatrist", "Rhinologist"],
  },

  {
    name: "Oncologist",
    category: "Oncology",
    subcategories: [],
  },
  {
    name: "Oncologist-Chemotherapist",
    category: "Oncology",
    subcategories: [],
  },
  {
    name: "Oncologist-Radiotherapist",
    category: "Oncology",
    subcategories: [],
  },
  { name: "Psychiatrist", category: "Mental Health", subcategories: [] },
  { name: "Psychologist", category: "Mental Health", subcategories: [] },
  { name: "Neurologist", category: "Mental Health", subcategories: [] },
  // --- ДОПОЛНИТЕЛЬНЫЕ СПЕЦИАЛИСТЫ ---
  {
    name: "Geriatrician",
    category: "Therapeutic Specialties",
    subcategories: [],
  },
  {
    name: "Sleep Medicine Specialist",
    category: "Therapeutic Specialties",
    subcategories: [],
  },
  {
    name: "Clinical Pharmacologist",
    category: "Therapeutic Specialties",
    subcategories: [],
  },
  {
    name: "Internal Medicine Doctor",
    category: "Therapeutic Specialties",
    subcategories: [],
  },
  {
    name: "Medical Geneticist",
    category: "Therapeutic Specialties",
    subcategories: [],
  },
  {
    name: "Toxicologist",
    category: "Therapeutic Specialties",
    subcategories: [],
  },
  {
    name: "Immunotherapist",
    category: "Therapeutic Specialties",
    subcategories: [],
  },

  { name: "Pediatric Neurologist", category: "Pediatrics", subcategories: [] },
  {
    name: "Pediatric Endocrinologist",
    category: "Pediatrics",
    subcategories: [],
  },
  { name: "Pediatric Oncologist", category: "Pediatrics", subcategories: [] },

  {
    name: "Gynecologic Oncologist",
    category: "Women’s Health",
    subcategories: [],
  },
  { name: "Breast Specialist", category: "Women’s Health", subcategories: [] },
  {
    name: "Menopause Specialist",
    category: "Women’s Health",
    subcategories: [],
  },

  { name: "Sexologist", category: "Men’s Health", subcategories: [] },

  { name: "Psychotherapist", category: "Mental Health", subcategories: [] },
  {
    name: "Addiction Specialist",
    category: "Mental Health",
    subcategories: [],
  },

  {
    name: "Oculoplastic Surgeon",
    category: "Surgical Specialties",
    subcategories: [],
  },
  {
    name: "Robotic Surgeon",
    category: "Surgical Specialties",
    subcategories: [],
  },
  {
    name: "Bariatric Surgeon",
    category: "Surgical Specialties",
    subcategories: [],
  },

  {
    name: "Neuro-ophthalmologist",
    category: "Ophthalmology and ENT",
    subcategories: [],
  },
  { name: "Oculist", category: "Ophthalmology and ENT", subcategories: [] },

  { name: "Cytologist", category: "Diagnostics", subcategories: [] },
  { name: "Biochemist", category: "Diagnostics", subcategories: [] },
  {
    name: "Molecular Diagnostics Specialist",
    category: "Diagnostics",
    subcategories: [],
  },
  {
    name: "Medical Imaging Specialist",
    category: "Diagnostics",
    subcategories: [],
  },

  { name: "Endodontist", category: "Dentistry", subcategories: [] },
  { name: "Dental Hygienist", category: "Dentistry", subcategories: [] },
  { name: "Oral Pathologist", category: "Dentistry", subcategories: [] },

  { name: "Chiropractor", category: "Rehabilitation", subcategories: [] },
  { name: "Osteopath", category: "Rehabilitation", subcategories: [] },
  { name: "Acupuncturist", category: "Rehabilitation", subcategories: [] },
  { name: "Speech Therapist", category: "Rehabilitation", subcategories: [] },
  {
    name: "Occupational Therapist",
    category: "Rehabilitation",
    subcategories: [],
  },
  {
    name: "Rehabilitation Psychologist",
    category: "Rehabilitation",
    subcategories: [],
  },

  { name: "Kinesiologist", category: "Sports Medicine", subcategories: [] },
  { name: "Athletic Trainer", category: "Sports Medicine", subcategories: [] },

  {
    name: "Disaster Medicine Specialist",
    category: "Emergency Care",
    subcategories: [],
  },
  { name: "Triage Specialist", category: "Emergency Care", subcategories: [] },
  {
    name: "Functional Diagnostics Specialist",
    category: "Diagnostics",
    subcategories: [],
  },
  { name: "Radiologist", category: "Diagnostics", subcategories: [] },
  {
    name: "Ultrasound Diagnostician",
    category: "Diagnostics",
    subcategories: [],
  },
  { name: "Pathologist", category: "Diagnostics", subcategories: [] },
  {
    name: "Forensic Medical Examiner",
    category: "Diagnostics",
    subcategories: [],
  },
  { name: "Geneticist", category: "Diagnostics", subcategories: [] },
  {
    name: "Laboratory Diagnostics Specialist",
    category: "Diagnostics",
    subcategories: [],
  },

  { name: "Dentist", category: "Dentistry", subcategories: [] },
  { name: "Orthodontist", category: "Dentistry", subcategories: [] },
  { name: "Periodontist", category: "Dentistry", subcategories: [] },
  { name: "Prosthodontist", category: "Dentistry", subcategories: [] },

  { name: "Physiotherapist", category: "Rehabilitation", subcategories: [] },
  {
    name: "Exercise Therapy Doctor",
    category: "Rehabilitation",
    subcategories: [],
  },

  { name: "Sports Doctor", category: "Sports Medicine", subcategories: [] },

  {
    name: "Emergency Medicine Doctor",
    category: "Emergency Care",
    subcategories: [],
  },
];
