import EchoEKGScan from "../../../../common/models/Polyclinic/ExamenationsTemplates/EchoEKGscanTemplates/EchoEKGscan.js";
import { decrypt } from "../../../../common/models/Auth/users.js";
import dayjs from "dayjs";

const getListEchoEKGScanController = async (req, res) => {
  const timestamp = dayjs().format("YYYY-MM-DD HH:mm:ss");
  const { patient } = req; // 🔥 ТОЛЬКО ТАК

  if (!patient) {
    return res.status(404).json({
      success: false,
      message: "Пациент не найден",
    });
  }

  console.log(
    `[${timestamp}] 🔍 [EchoEKGScan] Запрос списка Echo EKG для пациента ${patient._id}`,
  );

  try {
    const echoekgScansRaw = await EchoEKGScan.find({
      patient: patient._id, // ✅ ПРАВИЛЬНЫЙ ФИЛЬТР
      patientModel: patient.constructor.modelName, // ✅ ОБЯЗАТЕЛЬНО
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

    const echoekgScans = echoekgScansRaw.map((scan) => {
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
      `[${timestamp}] ✅ Найдено Echo EKG исследований: ${echoekgScans.length}`,
    );

    res.status(200).json({
      success: true,
      count: echoekgScans.length,
      data: echoekgScans,
    });
  } catch (error) {
    console.error(`[${timestamp}] ❌ Ошибка получения Echo EKG:`, error);

    res.status(500).json({
      success: false,
      message: "Ошибка при получении Echo EKG исследований",
      error: error.message,
    });
  }
};

export default getListEchoEKGScanController;
