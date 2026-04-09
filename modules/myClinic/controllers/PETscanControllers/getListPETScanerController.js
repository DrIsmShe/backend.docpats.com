import PETScan from "../../../../common/models/Polyclinic/ExamenationsTemplates/PETScansTemplates/PETScan.js";
import { decrypt } from "../../../../common/models/Auth/users.js";

const getListPETScanerController = async (req, res) => {
  try {
    const patient = req.patient;

    if (!patient) {
      return res.status(404).json({ message: "Пациент не найден" });
    }

    // автоматически определяем модель пациента
    const patientModel = patient.constructor.modelName;

    const scansRaw = await PETScan.find({
      patient: patient._id,
      patientModel,
    })
      .sort({ createdAt: -1 })
      .populate("doctor");

    /* 🔓 Расшифровка врача */
    const scans = scansRaw.map((scan) => {
      const scanObj = scan.toObject();

      if (scanObj.doctor?.firstNameEncrypted) {
        scanObj.doctor.firstName = decrypt(scanObj.doctor.firstNameEncrypted);
        scanObj.doctor.lastName = decrypt(scanObj.doctor.lastNameEncrypted);
      }

      return scanObj;
    });

    return res.status(200).json({
      success: true,
      count: scans.length,
      data: scans,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Ошибка получения PET",
      error: error.message,
    });
  }
};

export default getListPETScanerController;
