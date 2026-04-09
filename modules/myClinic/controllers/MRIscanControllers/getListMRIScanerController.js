import MRIScan from "../../../../common/models/Polyclinic/ExamenationsTemplates/MRIScansTemplates/MRIScan.js";
import { decrypt } from "../../../../common/models/Auth/users.js";
import dayjs from "dayjs";

const getListMRIScanerController = async (req, res) => {
  const timestamp = dayjs().format("YYYY-MM-DD HH:mm:ss");
  const { patient } = req; // 🔥 resolvePatient middleware

  if (!patient) {
    return res.status(404).json({
      success: false,
      message: "Пациент не найден",
    });
  }

  console.log(
    `[${timestamp}] 🔍 [MRIScan] Запрос списка МРТ для пациента ${patient._id}`,
  );

  try {
    const mriScansRaw = await MRIScan.find({
      patient: patient._id,
      patientModel: patient.constructor.modelName, // 🔥 ОБЯЗАТЕЛЬНО
    })
      .sort({ createdAt: -1 })
      .populate("patient", "firstNameEncrypted lastNameEncrypted birthDate")
      .populate(
        "doctor",
        "firstNameEncrypted lastNameEncrypted birthDate specialization",
      )
      .populate("nameofexamTemplate")
      .populate("reportTemplate")
      .populate("diagnosisTemplate")
      .populate("recomandationTemplate");

    // 🔓 Расшифровка
    const mriScans = mriScansRaw.map((scan) => {
      const scanObj = scan.toObject();

      if (scanObj.doctor?.firstNameEncrypted) {
        scanObj.doctor.firstName = decrypt(scanObj.doctor.firstNameEncrypted);
        scanObj.doctor.lastName = decrypt(scanObj.doctor.lastNameEncrypted);
      }

      if (scanObj.patient?.firstNameEncrypted) {
        scanObj.patient.firstName = decrypt(scanObj.patient.firstNameEncrypted);
        scanObj.patient.lastName = decrypt(scanObj.patient.lastNameEncrypted);
      }

      return scanObj;
    });

    console.log(
      `[${timestamp}] ✅ Найдено МРТ-исследований: ${mriScans.length}`,
    );

    res.status(200).json({
      success: true,
      count: mriScans.length,
      data: mriScans,
    });
  } catch (error) {
    console.error(`[${timestamp}] ❌ Ошибка получения МРТ:`, error);
    res.status(500).json({
      success: false,
      message: "Ошибка при получении МРТ-исследований",
      error: error.message,
    });
  }
};

export default getListMRIScanerController;
