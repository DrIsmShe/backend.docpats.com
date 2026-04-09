import GastroscopyScan from "../../../../common/models/Polyclinic/ExamenationsTemplates/GastroscopyScansTemplates/GastroscopyScan.js";
import { decrypt } from "../../../../common/models/Auth/users.js";
import dayjs from "dayjs";

const getListGastroscopyScanController = async (req, res) => {
  const timestamp = dayjs().format("YYYY-MM-DD HH:mm:ss");
  const { patient } = req; // 🔥 ТОЛЬКО через resolvePatient

  if (!patient) {
    return res.status(404).json({
      success: false,
      message: "Пациент не найден",
    });
  }

  console.log(
    `[${timestamp}] 🔍 [GastroscopyScan] Запрос списка гастроскопии для пациента ${patient._id}`,
  );

  try {
    const gastroscopyScansRaw = await GastroscopyScan.find({
      patient: patient._id, // ✅ единственно правильный фильтр
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

    const gastroscopyScans = gastroscopyScansRaw.map((scan) => {
      const scanObj = scan.toObject();

      // 🔓 Расшифровка врача
      if (scanObj.doctor?.firstNameEncrypted) {
        scanObj.doctor.firstName = decrypt(scanObj.doctor.firstNameEncrypted);
        scanObj.doctor.lastName = decrypt(scanObj.doctor.lastNameEncrypted);
      }

      // 🔓 Расшифровка пациента
      if (scanObj.patient?.firstNameEncrypted) {
        scanObj.patient.firstName = decrypt(scanObj.patient.firstNameEncrypted);
        scanObj.patient.lastName = decrypt(scanObj.patient.lastNameEncrypted);
      }

      return scanObj;
    });

    console.log(
      `[${timestamp}] ✅ Найдено гастроскопий: ${gastroscopyScans.length}`,
    );

    res.status(200).json({
      success: true,
      count: gastroscopyScans.length,
      data: gastroscopyScans,
    });
  } catch (error) {
    console.error(`[${timestamp}] ❌ Ошибка получения гастроскопии:`, error);

    res.status(500).json({
      success: false,
      message: "Ошибка при получении гастроскопии",
      error: error.message,
    });
  }
};

export default getListGastroscopyScanController;
