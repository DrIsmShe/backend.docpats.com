import mongoose from "mongoose";
import NewPatientPolyclinic from "../../../common/models/Polyclinic/newPatientPolyclinic.js";
import User, { decrypt } from "../../../common/models/Auth/users.js";
import NewPatientMedicalHistory from "../../../common/models/Polyclinic/MedicalHistory/newPatientMedicalHistory.js";
import File from "../../../common/models/file.js";

/* === все модели обследований === */
import CTScan from "../../../common/models/Polyclinic/ExamenationsTemplates/CTScansTemplates/CTScan.js";
import MRIScan from "../../../common/models/Polyclinic/ExamenationsTemplates/MRIScansTemplates/MRIScan.js";
import Angiographyscan from "../../../common/models/Polyclinic/ExamenationsTemplates/AngiographyscanTemplates/Angiographyscan.js";
import DopplerScan from "../../../common/models/Polyclinic//ExamenationsTemplates/DoplerScansTemplates/DoplerScan.js";
import PETScan from "../../../common/models/Polyclinic/ExamenationsTemplates/PETScansTemplates/PETScan.js";

/**
 * @route   GET /admin/polyclinic-patient-detail-get/:id
 * @desc    Получить полную информацию о пациенте (врачи, истории, обследования)
 * @access  Admin / Doctor
 */
export const PolyclinicPatientDetailGetController = async (req, res) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res
        .status(400)
        .json({ success: false, message: "Некорректный ID пациента." });
    }

    const decryptSafe = (val) => {
      try {
        return decrypt(val) || "";
      } catch {
        return "";
      }
    };

    // === 1️⃣ Пациент ===
    const patient = await NewPatientPolyclinic.findById(id)
      .populate({
        path: "doctorId",
        model: User,
        select:
          "username avatar role firstNameEncrypted lastNameEncrypted emailEncrypted phoneEncrypted country",
        strictPopulate: false,
      })
      .populate({
        path: "linkedUserId",
        model: User,
        select:
          "username avatar role firstNameEncrypted lastNameEncrypted emailEncrypted phoneEncrypted",
        strictPopulate: false,
      })
      .lean();

    if (!patient)
      return res
        .status(404)
        .json({ success: false, message: "Пациент не найден." });

    const decryptedPatient = {
      ...patient,
      photo: patient.photo || null,
      firstName: decryptSafe(patient.firstNameEncrypted),
      lastName: decryptSafe(patient.lastNameEncrypted),
      email: decryptSafe(patient.emailEncrypted),
      phoneNumber: decryptSafe(patient.phoneEncrypted),
      fullName: `${decryptSafe(patient.firstNameEncrypted)} ${decryptSafe(
        patient.lastNameEncrypted
      )}`.trim(),
    };

    // === 2️⃣ Истории болезней ===
    const histories = await NewPatientMedicalHistory.find({ patientId: id })
      .populate({
        path: "doctorId",
        model: User,
        select:
          "firstNameEncrypted lastNameEncrypted emailEncrypted phoneEncrypted role avatar",
        strictPopulate: false,
      })
      .sort({ createdAt: -1 })
      .lean();

    const decryptedHistories = histories.map((h) => ({
      _id: h._id,
      diagnosis: h.diagnosis || "—",
      description: h.description || h.notes || "—",
      createdAt: h.createdAt,
      doctorId: h.doctorId
        ? {
            _id: h.doctorId._id,
            avatar: h.doctorId.avatar,
            role: h.doctorId.role,
            firstName: decryptSafe(h.doctorId.firstNameEncrypted),
            lastName: decryptSafe(h.doctorId.lastNameEncrypted),
            fullName: `${decryptSafe(
              h.doctorId.firstNameEncrypted
            )} ${decryptSafe(h.doctorId.lastNameEncrypted)}`.trim(),
          }
        : null,
    }));

    // === 3️⃣ Универсальная функция получения обследований ===
    const fetchExaminations = async (Model, studyType) => {
      const data = await Model.find({ patientId: id })
        .populate({
          path: "doctorId",
          model: User,
          select:
            "firstNameEncrypted lastNameEncrypted emailEncrypted phoneEncrypted role avatar",
          strictPopulate: false,
        })
        .sort({ createdAt: -1 })
        .lean();

      return data.map((ex) => ({
        _id: ex._id,
        studyTypeReference: studyType,
        report: ex.report || ex.reportText || "—",
        recomandation: ex.recomandation || ex.recommendation || "—",
        createdAt: ex.createdAt || null,
        doctorId: ex.doctorId
          ? {
              _id: ex.doctorId._id,
              avatar: ex.doctorId.avatar,
              role: ex.doctorId.role,
              firstName: decryptSafe(ex.doctorId.firstNameEncrypted),
              lastName: decryptSafe(ex.doctorId.lastNameEncrypted),
              fullName: `${decryptSafe(
                ex.doctorId.firstNameEncrypted
              )} ${decryptSafe(ex.doctorId.lastNameEncrypted)}`.trim(),
            }
          : null,
      }));
    };

    // === 4️⃣ Сбор всех обследований из разных коллекций ===
    const [
      ctScans,
      mriScans,
      angiographyScans,
      dopplerScans,
      petScans,
      fileScans,
    ] = await Promise.all([
      fetchExaminations(CTScan, "CTScan"),
      fetchExaminations(MRIScan, "MRIScan"),
      fetchExaminations(Angiographyscan, "Angiography"),
      fetchExaminations(DopplerScan, "DopplerScan"),
      fetchExaminations(PETScan, "PETScan"),
      File.find({
        patientId: id,
        studyTypeReference: { $exists: true, $ne: null },
      })
        .sort({ createdAt: -1 })
        .lean(),
    ]);

    // === 5️⃣ Объединяем всё в один массив ===
    const allExaminations = [
      ...ctScans,
      ...mriScans,
      ...angiographyScans,
      ...dopplerScans,
      ...petScans,
      ...fileScans.map((f) => ({
        _id: f._id,
        studyTypeReference: f.studyTypeReference,
        report: f.report || "—",
        recomandation: f.recomandation || "—",
        createdAt: f.createdAt,
        doctorId: null,
      })),
    ];

    // === 6️⃣ Итог ===
    return res.status(200).json({
      success: true,
      data: {
        ...decryptedPatient,
        histories: decryptedHistories,
        examinations: allExaminations,
      },
    });
  } catch (error) {
    console.error("Ошибка в PolyclinicPatientDetailGetController:", error);
    res.status(500).json({
      success: false,
      message: "Ошибка сервера при получении информации о пациенте.",
      error: error.message,
    });
  }
};
