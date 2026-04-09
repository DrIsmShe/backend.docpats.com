import USMscan from "../../../../common/models/Polyclinic/ExamenationsTemplates/USMscanTemplates/USMscan.js";
import { decrypt } from "../../../../common/models/Auth/users.js";
import dayjs from "dayjs";

const getListXRAYScanerController = async (req, res) => {
  const timestamp = dayjs().format("YYYY-MM-DD HH:mm:ss");

  const { patient } = req; // 🔥 используем resolvePatient middleware

  if (!patient) {
    return res.status(404).json({
      success: false,
      message: "Пациент не найден",
    });
  }

  console.log(
    `[${timestamp}] 🔍 [USMscan] Запрос списка XRAY для пациента ${patient._id}`,
  );

  try {
    const xrayScansRaw = await USMscan.find({
      patient: patient._id, // 🔥 ВАЖНО
    })
      .sort({ createdAt: -1 })
      .populate("patient", "firstNameEncrypted lastNameEncrypted birthDate")
      .populate("doctor", "firstNameEncrypted lastNameEncrypted birthDate")
      .populate("reportTemplate")
      .populate("diagnosisTemplate")
      .populate("recomandationTemplate");

    const xrayScans = xrayScansRaw.map((scan) => {
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
      `[${timestamp}] ✅ Найдено XRAY-исследований: ${xrayScans.length}`,
    );

    res.status(200).json({
      success: true,
      count: xrayScans.length,
      data: xrayScans,
    });
  } catch (error) {
    console.error(`[${timestamp}] ❌ Ошибка получения XRAY:`, error);

    res.status(500).json({
      success: false,
      message: "Ошибка при получении XRAY-исследований",
      error: error.message,
    });
  }
};

export default getListXRAYScanerController;
