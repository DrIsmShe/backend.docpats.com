// server/modules/polyclinic/controllers/polyclinicGetController.js
import mongoose from "mongoose";
import NewPatientPolyclinic from "../../../common/models/Polyclinic/newPatientPolyclinic.js";
import newPatientMedicalHistory from "../../../common/models/Polyclinic/MedicalHistory/newPatientMedicalHistory.js";
import File from "../../../common/models/file.js";
import DoctorProfile from "../../../common/models/DoctorProfile/profileDoctor.js";
import PatientProfile from "../../../common/models/PatientProfile/patientProfile.js";
import User, { decrypt } from "../../../common/models/Auth/users.js";

/**
 * @route   GET /polyclinic/get-all
 * @desc    Получает всю информацию по поликлинике:
 *          - Пациенты (NewPatientPolyclinic)
 *          - Истории болезней (newPatientMedicalHistory)
 *          - Файлы (File)
 *          - Связанные врачи (DoctorProfile, User)
 * @access  Admin / Doctor
 */
export const polyclinicGetController = async (req, res) => {
  try {
    const safeDecrypt = (value) => {
      if (!value) return undefined;
      try {
        return decrypt(value);
      } catch {
        return undefined;
      }
    };

    /* ================= PATIENTS ================= */

    const patients = await NewPatientPolyclinic.find({})
      .populate({
        path: "linkedUserId",
        select:
          "username role avatar firstNameEncrypted lastNameEncrypted emailEncrypted",
      })
      .populate({
        path: "doctorId",
        select:
          "username role avatar firstNameEncrypted lastNameEncrypted emailEncrypted",
      })
      .lean();

    const decryptedPatients = patients.map((p) => ({
      ...p,
      firstName: safeDecrypt(p.firstNameEncrypted),
      lastName: safeDecrypt(p.lastNameEncrypted),
      email: safeDecrypt(p.emailEncrypted),
      linkedUser: p.linkedUserId
        ? {
            ...p.linkedUserId,
            firstName: safeDecrypt(p.linkedUserId.firstNameEncrypted),
            lastName: safeDecrypt(p.linkedUserId.lastNameEncrypted),
            email: safeDecrypt(p.linkedUserId.emailEncrypted),
          }
        : null,
      doctors:
        p.doctorId?.map((doc) => ({
          ...doc,
          firstName: safeDecrypt(doc.firstNameEncrypted),
          lastName: safeDecrypt(doc.lastNameEncrypted),
          email: safeDecrypt(doc.emailEncrypted),
        })) || [],
    }));

    /* ================= MEDICAL HISTORIES ================= */

    const medicalHistories = await newPatientMedicalHistory
      .find({})
      .populate("patientRef")
      .populate({
        path: "doctorId",
        select: "username role firstNameEncrypted lastNameEncrypted",
      })
      .populate({ path: "doctorProfileId" })
      .lean();

    /* ================= FILES ================= */

    const files = await File.find({})
      .populate({
        path: "patient", // ✅ исправлено
        select: "firstNameEncrypted lastNameEncrypted emailEncrypted",
      })
      .populate({
        path: "uploadedByDoctor",
        select: "username role avatar firstNameEncrypted lastNameEncrypted",
      })
      .lean();

    /* ================= DOCTOR PROFILES ================= */

    const doctorProfiles = await DoctorProfile.find({})
      .populate({
        path: "userId",
        select:
          "username role avatar firstNameEncrypted lastNameEncrypted emailEncrypted",
      })
      .lean();

    /* ================= PATIENT PROFILES ================= */

    const patientProfiles = await PatientProfile.find({})
      .populate({
        path: "userId",
        select:
          "username role avatar firstNameEncrypted lastNameEncrypted emailEncrypted",
      })
      .lean();

    return res.status(200).json({
      success: true,
      total: {
        patients: decryptedPatients.length,
        medicalHistories: medicalHistories.length,
        files: files.length,
        doctorProfiles: doctorProfiles.length,
        patientProfiles: patientProfiles.length,
      },
      data: {
        patients: decryptedPatients,
        medicalHistories,
        files,
        doctorProfiles: doctorProfiles.map((doc) => ({
          ...doc,
          user: doc.userId
            ? {
                ...doc.userId,
                firstName: safeDecrypt(doc.userId.firstNameEncrypted),
                lastName: safeDecrypt(doc.userId.lastNameEncrypted),
                email: safeDecrypt(doc.userId.emailEncrypted),
              }
            : null,
        })),
        patientProfiles: patientProfiles.map((p) => ({
          ...p,
          user: p.userId
            ? {
                ...p.userId,
                firstName: safeDecrypt(p.userId.firstNameEncrypted),
                lastName: safeDecrypt(p.userId.lastNameEncrypted),
                email: safeDecrypt(p.userId.emailEncrypted),
              }
            : null,
        })),
      },
    });
  } catch (error) {
    console.error("❌ polyclinicGetController error:", error);
    return res.status(500).json({
      success: false,
      message: "Ошибка при получении данных поликлиники",
    });
  }
};
