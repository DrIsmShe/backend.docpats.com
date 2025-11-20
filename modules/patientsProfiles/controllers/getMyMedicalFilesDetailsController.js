// ✅ server/modules/patient-profile/controllers/getMyMedicalFilesDetailsController.js
import mongoose from "mongoose";
import NewPatientPolyclinic from "../../../common/models/Polyclinic/newPatientPolyclinic.js";

// 📦 Импорт всех моделей исследований
import "../../../common/models/Polyclinic/ExamenationsTemplates/CTScansTemplates/CTScan.js";
import "../../../common/models/Polyclinic/ExamenationsTemplates/MRIScansTemplates/MRIScan.js";
import "../../../common/models/Polyclinic/ExamenationsTemplates/USMscanTemplates/USMscan.js";
import "../../../common/models/Polyclinic/ExamenationsTemplates/XRayScansTemplates/XRayScan.js";
import "../../../common/models/Polyclinic/ExamenationsTemplates/PETScansTemplates/PETScan.js";
import "../../../common/models/Polyclinic/ExamenationsTemplates/SPECTScansTemplates/SPECTScan.js";
import "../../../common/models/Polyclinic/ExamenationsTemplates/GinecologyTemplates/Ginecology.js";
import "../../../common/models/Polyclinic/ExamenationsTemplates/EEGScansTemplates/EEGScan.js";
import "../../../common/models/Polyclinic/ExamenationsTemplates/HOLTERscanTemplates/HOLTERscan.js";
import "../../../common/models/Polyclinic/ExamenationsTemplates/SpirometryScansTemplates/SpirometryScan.js";
import "../../../common/models/Polyclinic/ExamenationsTemplates/DoplerScansTemplates/DoplerScan.js";
import "../../../common/models/Polyclinic/ExamenationsTemplates/GastroscopyScansTemplates/GastroscopyScan.js";
import "../../../common/models/Polyclinic/ExamenationsTemplates/CapsuleEndoscopyScansTemplates/CapsuleEndoscopyScan.js";
import "../../../common/models/Polyclinic/ExamenationsTemplates/AngiographyscanTemplates/Angiographyscan.js";
import "../../../common/models/Polyclinic/ExamenationsTemplates/EKGscanTemplates/EKGscan.js";
import "../../../common/models/Polyclinic/ExamenationsTemplates/EchoEKGscanTemplates/EchoEKGscan.js";
import "../../../common/models/Polyclinic/ExamenationsTemplates/CoronographyscanTemplates/Coronographyscan.js";
import "../../../common/models/Polyclinic/ExamenationsTemplates/Labtest/LabTest.js";

// ✅ Карта моделей
const studyModels = {
  CTScan: mongoose.models.CTScan,
  MRIScan: mongoose.models.MRIScan,
  USMScan: mongoose.models.USMScan,
  XRAYScan: mongoose.models.XRAYScan,
  PETScan: mongoose.models.PETScan,
  SPECTScan: mongoose.models.SPECTScan,
  GinecologyScan: mongoose.models.Ginecology,
  EEGScan: mongoose.models.EEGScan,
  HOLTERScan: mongoose.models.HOLTERscan,
  SpirometryScan: mongoose.models.SpirometryScan,
  DoplerScan: mongoose.models.DoplerScan,
  GastroscopyScan: mongoose.models.GastroscopyScan,
  CapsuleEndoscopy: mongoose.models.CapsuleEndoscopyScan,
  AngiographyScan: mongoose.models.Angiographyscan,
  EKGScan: mongoose.models.EKGscan,
  EchoEKGScan: mongoose.models.EchoEKGscan,
  CoronographyScan: mongoose.models.Coronographyscan,
  LabTest: mongoose.models.LabTest,
};

// ✅ Безопасный импорт модели
const safeImport = async (modelName, path) => {
  if (mongoose.models[modelName]) {
    return mongoose.model(modelName);
  }
  const module = await import(path);
  return module.default;
};

// ========================================================================
// 📋 Основной контроллер
// ========================================================================
const getMyMedicalFilesDetailsController = async (req, res) => {
  try {
    const { patientId } = req.params;
    const { studyType, startDate, endDate } = req.query;

    // 🔎 Проверка параметров
    if (!mongoose.Types.ObjectId.isValid(patientId)) {
      return res.status(400).json({ message: "Неверный формат patientId." });
    }

    // 🔍 Ищем пациента по linkedUserId или userId
    const patient = await NewPatientPolyclinic.findOne({
      $or: [
        { linkedUserId: new mongoose.Types.ObjectId(patientId) },
        { userId: new mongoose.Types.ObjectId(patientId) },
      ],
    });

    if (!patient) {
      console.warn(
        `⛔ Пациент с userId=${patientId} не найден или не привязан к поликлинике.`
      );
      return res.status(404).json({
        message: "⛔ Пациент не привязан к поликлинике или не найден.",
      });
    }

    const results = [];

    // Определяем, какие типы исследований искать
    const typesToSearch = studyType ? [studyType] : Object.keys(studyModels);

    for (const type of typesToSearch) {
      const Model = studyModels[type];
      if (!Model) continue;

      // Формируем фильтр
      const filter = { patientId: patient._id };
      if (startDate || endDate) {
        filter.createdAt = {};
        if (startDate) filter.createdAt.$gte = new Date(startDate);
        if (endDate) filter.createdAt.$lte = new Date(endDate);
      }

      // Загружаем исследования
      const scans = await Model.find(filter)
        .populate("doctor")
        .populate("files")
        .sort({ createdAt: -1 });

      // Обрабатываем каждое исследование
      for (const scan of scans) {
        const doctor = scan.doctor;
        const doctorInfo = {
          _id: doctor?._id || null,
          firstName: "?",
          lastName: "?",
        };

        if (doctor && typeof doctor.decryptFields === "function") {
          const decrypted = doctor.decryptFields();
          doctorInfo.firstName = decrypted.firstName || "?";
          doctorInfo.lastName = decrypted.lastName || "?";
        }

        results.push({
          _id: scan._id,
          type,
          nameofexam: scan.nameofexam || "",
          diagnosis: scan.diagnosis || "",
          report: scan.report || "",
          recomandation: scan.recomandation || "",
          createdAt: scan.createdAt,
          doctor: doctorInfo,
          files: (scan.files || []).map((file) => ({
            _id: file._id,
            fileName: file.fileName,
            fileUrl: file.fileUrl,
            fileType: file.fileType,
            fileSize: file.fileSize,
            uploadedAt: file.uploadedAt,
          })),
        });
      }
    }

    // ✅ Возвращаем результат
    return res.status(200).json(results);
  } catch (err) {
    console.error("❌ Ошибка при получении медицинских исследований:", err);
    return res.status(500).json({
      message: "Ошибка сервера при получении медицинских исследований.",
    });
  }
};

export default getMyMedicalFilesDetailsController;
