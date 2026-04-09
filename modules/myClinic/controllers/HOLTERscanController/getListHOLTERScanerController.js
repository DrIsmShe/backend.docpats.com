import HOLTERScan from "../../../../common/models/Polyclinic/ExamenationsTemplates/HOLTERscanTemplates/HOLTERscan.js";
import { decrypt } from "../../../../common/models/Auth/users.js";
import dayjs from "dayjs";

const getListHOLTERScanController = async (req, res) => {
  const timestamp = dayjs().format("YYYY-MM-DD HH:mm:ss");
  const { patient } = req; // 🔥 ТОЛЬКО ТАК

  if (!patient) {
    return res.status(404).json({
      success: false,
      message: "Пациент не найден",
    });
  }

  console.log(
    `[${timestamp}] 🔍 [HOLTERScan] Запрос списка HOLTER для пациента ${patient._id}`,
  );

  try {
    const holterScansRaw = await HOLTERScan.find({
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

    const holterScans = holterScansRaw.map((scan) => {
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
      `[${timestamp}] ✅ Найдено HOLTER-исследований: ${holterScans.length}`,
    );

    return res.status(200).json({
      success: true,
      count: holterScans.length,
      data: holterScans,
    });
  } catch (error) {
    console.error(`[${timestamp}] ❌ Ошибка получения HOLTER:`, error);

    return res.status(500).json({
      success: false,
      message: "Ошибка при получении HOLTER-исследований",
      error: error.message,
    });
  }
};

export default getListHOLTERScanController;
