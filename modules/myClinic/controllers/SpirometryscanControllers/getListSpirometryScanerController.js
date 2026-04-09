import SpirometryScan from "../../../../common/models/Polyclinic/ExamenationsTemplates/SpirometryScansTemplates/SpirometryScan.js";
import { decrypt } from "../../../../common/models/Auth/users.js";
import dayjs from "dayjs";

const getListSpirometryScanerController = async (req, res) => {
  const timestamp = dayjs().format("YYYY-MM-DD HH:mm:ss");
  const { patient } = req; // 🔥 ТОЛЬКО ЧЕРЕЗ resolvePatient

  if (!patient) {
    return res.status(404).json({
      success: false,
      message: "Пациент не найден",
    });
  }

  console.log(
    `[${timestamp}] 🔍 [SpirometryScan] Запрос списка спирометрии для пациента ${patient._id}`,
  );

  try {
    const spirometryScansRaw = await SpirometryScan.find({
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

    const spirometryScans = spirometryScansRaw.map((scan) => {
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
      `[${timestamp}] ✅ Найдено исследований спирометрии: ${spirometryScans.length}`,
    );

    res.status(200).json({
      success: true,
      count: spirometryScans.length,
      data: spirometryScans,
    });
  } catch (error) {
    console.error(`[${timestamp}] ❌ Ошибка получения спирометрии:`, error);

    res.status(500).json({
      success: false,
      message: "Ошибка при получении исследований спирометрии",
      error: error.message,
    });
  }
};

export default getListSpirometryScanerController;
