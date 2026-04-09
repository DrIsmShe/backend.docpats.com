// server/controllers/clinic/privatePatientDetailsController.js

import mongoose from "mongoose";
import DoctorPrivatePatient from "../../../common/models/Polyclinic/DoctorPrivatePatient.js";

/* ======================== R2 helpers ======================== */

const R2_PUBLIC = (
  process.env.R2_PUBLIC_URL ||
  "https://pub-02fd367c4d0849cab12ceeb5bb357124.r2.dev"
).replace(/\/+$/, "");

const normalizeUploadsPath = (p) =>
  String(p || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/^uploads\/+/, "");

const toUploadsUrl = (p) => `${R2_PUBLIC}/uploads/${normalizeUploadsPath(p)}`;

const isPlaceholder = (p) => {
  const name = normalizeUploadsPath(p).toLowerCase();
  return (
    !name ||
    name === "default.png" ||
    name === "default.jpg" ||
    name.startsWith("default/")
  );
};

const pickDefaultByGender = (gender) => {
  switch (String(gender || "").toLowerCase()) {
    case "female":
      return "default/default-patient-woman.png";
    case "male":
      return "default/default-patient-man.png";
    default:
      return "default/default-patient.png";
  }
};

const buildPhotoUrl = ({ image, gender }) => {
  // абсолютная ссылка → принимаем только R2
  if (/^https?:\/\//i.test(image)) {
    if (/r2\.dev|cloudflarestorage\.com/i.test(image)) return image;
    return toUploadsUrl(pickDefaultByGender(gender));
  }

  // относительный путь
  if (image && !isPlaceholder(image)) {
    return toUploadsUrl(image);
  }

  // дефолт
  return toUploadsUrl(pickDefaultByGender(gender));
};

/* ========================== CONTROLLER ========================== */

const privatePatientDetailsController = async (req, res) => {
  try {
    const { patient, patientType } = req;

    if (patientType !== "private") {
      return res.status(400).json({
        message: "Это не private-пациент",
      });
    }

    // patient УЖЕ найден в resolvePatient
    const p = patient.toObject({ virtuals: true });

    const dto = {
      _id: p._id,

      /* ---------------- IDENTITY ---------------- */
      firstName: p.firstName || "",
      lastName: p.lastName || "",
      fullName: p.fullName || "",
      email: p.email || "",
      phoneNumber: p.phoneNumber || "",
      gender: p.gender || "unknown",
      dateOfBirth: p.dateOfBirth || null,
      externalId: p.externalId || "",

      /* ---------------- ADDRESS ---------------- */
      address: {
        country: p.address?.country || "",
        city: p.address?.city || "",
        street: p.address?.street || "",
        house: p.address?.house || "",
        apartment: p.address?.apartment || "",
      },

      /* ---------------- MEDICAL ---------------- */
      medicalProfile: {
        immunization: p.medicalProfile?.immunization || "",
        allergies: p.medicalProfile?.allergies || "",
        chronicDiseases: p.medicalProfile?.chronicDiseases || "",
        familyHistoryOfDisease: p.medicalProfile?.familyHistoryOfDisease || "",
        operations: p.medicalProfile?.operations || "",
        badHabits: p.medicalProfile?.badHabits || "",
        about: p.medicalProfile?.about || "",
      },

      mainDiagnosisText: p.mainDiagnosisText || "",
      mainDiagnosisCode: p.mainDiagnosisCode || "",
      mainComplaint: p.mainComplaint || "",
      tags: p.tags || [],
      notes: p.notes || "",

      /* ---------------- IMAGE ---------------- */
      photo: buildPhotoUrl({
        image: p.image,
        gender: p.gender,
      }),

      /* ---------------- LINK / MIGRATION ---------------- */
      migrationStatus: p.migrationStatus,
      linkedUserId: p.linkedUserId || null,
      linkedPatientProfileId: p.linkedPatientProfileId || null,
      migratedAt: p.migratedAt || null,
      linkHistory: p.linkHistory || [],

      /* ---------------- STATUS ---------------- */
      isFavorite: !!p.isFavorite,
      isArchived: !!p.isArchived,
      archivedAt: p.archivedAt || null,
      archiveReason: p.archiveReason || "",

      /* ---------------- META ---------------- */
      doctorProfileId: p.doctorProfileId,
      doctorUserId: p.doctorUserId,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    };

    return res.status(200).json(dto);
  } catch (error) {
    console.error("❌ privatePatientDetailsController error:", error);
    return res.status(500).json({
      message: "Ошибка сервера при получении private-пациента",
    });
  }
};

export default privatePatientDetailsController;
