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
    // Основные данные пациентов поликлиники
    const patients = await NewPatientPolyclinic.find({})
      .populate({
        path: "linkedUserId",
        model: User,
        select:
          "username role avatar firstNameEncrypted lastNameEncrypted emailEncrypted",
      })
      .populate({
        path: "doctorId",
        model: User,
        select:
          "username role avatar firstNameEncrypted lastNameEncrypted emailEncrypted",
      })
      .lean();

    // Расшифровка зашифрованных полей (имя, фамилия, email)
    const decryptedPatients = patients.map((p) => ({
      ...p,
      firstName: p.firstNameEncrypted
        ? decrypt(p.firstNameEncrypted)
        : undefined,
      lastName: p.lastNameEncrypted ? decrypt(p.lastNameEncrypted) : undefined,
      email: p.emailEncrypted ? decrypt(p.emailEncrypted) : undefined,
      linkedUser:
        p.linkedUserId && typeof p.linkedUserId === "object"
          ? {
              ...p.linkedUserId,
              firstName: decrypt(p.linkedUserId.firstNameEncrypted),
              lastName: decrypt(p.linkedUserId.lastNameEncrypted),
              email: decrypt(p.linkedUserId.emailEncrypted),
            }
          : null,
      doctors:
        p.doctorId?.map((doc) => ({
          ...doc,
          firstName: decrypt(doc.firstNameEncrypted),
          lastName: decrypt(doc.lastNameEncrypted),
          email: decrypt(doc.emailEncrypted),
        })) || [],
    }));

    // Медицинские истории пациентов
    const medicalHistories = await newPatientMedicalHistory
      .find({})
      .populate({ path: "patientId", model: "NewPatientPolyclinic" })
      .populate({
        path: "doctorId",
        model: "User",
        select: "username role firstNameEncrypted lastNameEncrypted",
      })
      .populate({ path: "doctorProfileId", model: "DoctorProfile" })
      .lean();

    // Файлы, прикрепленные к пациентам
    const files = await File.find({})
      .populate({
        path: "patientId",
        model: "NewPatientPolyclinic",
        select: "firstNameEncrypted lastNameEncrypted emailEncrypted",
      })
      .populate({
        path: "uploadedByDoctor",
        model: "User",
        select: "username role avatar firstNameEncrypted lastNameEncrypted",
      })
      .lean();

    // Все врачи поликлиники (связанные с пациентами)
    const doctorProfiles = await DoctorProfile.find({})
      .populate({
        path: "userId",
        model: "User",
        select:
          "username role avatar firstNameEncrypted lastNameEncrypted emailEncrypted",
      })
      .lean();

    // Профили пациентов (расширенные карточки)
    const patientProfiles = await PatientProfile.find({})
      .populate({
        path: "userId",
        model: "User",
        select:
          "username role avatar firstNameEncrypted lastNameEncrypted emailEncrypted",
      })
      .lean();

    // 🔹 Формируем итоговый объект
    const result = {
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
                firstName: decrypt(doc.userId.firstNameEncrypted),
                lastName: decrypt(doc.userId.lastNameEncrypted),
                email: decrypt(doc.userId.emailEncrypted),
              }
            : null,
        })),
        patientProfiles: patientProfiles.map((p) => ({
          ...p,
          user: p.userId
            ? {
                ...p.userId,
                firstName: decrypt(p.userId.firstNameEncrypted),
                lastName: decrypt(p.userId.lastNameEncrypted),
                email: decrypt(p.userId.emailEncrypted),
              }
            : null,
        })),
      },
    };

    return res.status(200).json(result);
  } catch (error) {
    console.error("❌ polyclinicGetController error:", error);
    return res.status(500).json({
      success: false,
      message: "Ошибка при получении данных поликлиники",
      error: error.message,
    });
  }
};
