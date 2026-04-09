import CapsuleEndoscopyScan from "../../../../common/models/Polyclinic/ExamenationsTemplates/CapsuleEndoscopyScansTemplates/CapsuleEndoscopyScan.js";
import { decrypt } from "../../../../common/models/Auth/users.js";
import dayjs from "dayjs";

const getListCapsuleEndoscopySScanController = async (req, res) => {
  const timestamp = dayjs().format("YYYY-MM-DD HH:mm:ss");
  const { patient } = req; // 🔥 ВАЖНО

  if (!patient) {
    return res.status(404).json({
      success: false,
      message: "Пациент не найден",
    });
  }

  console.log(
    `[${timestamp}] 🔍 [CapsuleEndoscopyScan] Запрос списка Capsule Endoscopy для пациента ${patient._id}`,
  );

  try {
    const capsuleEndoscopyScansRaw = await CapsuleEndoscopyScan.find({
      patient: patient._id, // ✅ ФИЛЬТР 1
      patientModel: patient.constructor.modelName, // ✅ ФИЛЬТР 2
    })
      .sort({ createdAt: -1 })
      .populate("patient", "firstNameEncrypted lastNameEncrypted birthDate")
      .populate("doctor", "firstNameEncrypted lastNameEncrypted birthDate")
      .populate("reportTemplate")
      .populate("diagnosisTemplate")
      .populate("recomandationTemplate");

    const capsuleEndoscopyScans = capsuleEndoscopyScansRaw.map((scan) => {
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
      `[${timestamp}] ✅ Найдено Capsule Endoscopy исследований: ${capsuleEndoscopyScans.length}`,
    );

    res.status(200).json({
      success: true,
      count: capsuleEndoscopyScans.length,
      data: capsuleEndoscopyScans,
    });
  } catch (error) {
    console.error(
      `[${timestamp}] ❌ Ошибка получения Capsule Endoscopy:`,
      error,
    );
    res.status(500).json({
      success: false,
      message: "Ошибка при получении Capsule Endoscopy исследований",
      error: error.message,
    });
  }
};

export default getListCapsuleEndoscopySScanController;
