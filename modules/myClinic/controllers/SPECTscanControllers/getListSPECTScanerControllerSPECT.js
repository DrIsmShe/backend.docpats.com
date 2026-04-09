import SPECTScan from "../../../../common/models/Polyclinic/ExamenationsTemplates/SPECTScansTemplates/SPECTScan.js";
import { decrypt } from "../../../../common/models/Auth/users.js";
import dayjs from "dayjs";

const getListSPECTScanerController = async (req, res) => {
  const timestamp = dayjs().format("YYYY-MM-DD HH:mm:ss");
  const { patient } = req; // 🔥 ТОЛЬКО ТАК

  if (!patient) {
    return res.status(404).json({
      success: false,
      message: "Пациент не найден",
    });
  }

  console.log(
    `[${timestamp}] 🔍 [SPECTScan] Запрос списка SPECT для пациента ${patient._id}`,
  );

  try {
    const spectScansRaw = await SPECTScan.find({
      patient: patient._id, // ✅ ЕДИНСТВЕННЫЙ ПРАВИЛЬНЫЙ ФИЛЬТР
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

    const spectScans = spectScansRaw.map((scan) => {
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
      `[${timestamp}] ✅ Найдено SPECT-исследований: ${spectScans.length}`,
    );

    res.status(200).json({
      success: true,
      count: spectScans.length,
      data: spectScans,
    });
  } catch (error) {
    console.error(`[${timestamp}] ❌ Ошибка получения SPECT:`, error);
    res.status(500).json({
      success: false,
      message: "Ошибка при получении SPECT-исследований",
      error: error.message,
    });
  }
};

export default getListSPECTScanerController;
