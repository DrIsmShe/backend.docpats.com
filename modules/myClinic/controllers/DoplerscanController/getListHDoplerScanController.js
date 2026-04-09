import DoplerScan from "../../../../common/models/Polyclinic/ExamenationsTemplates/DoplerScansTemplates/DoplerScan.js";
import { decrypt } from "../../../../common/models/Auth/users.js";
import dayjs from "dayjs";

const getListDoplerScanController = async (req, res) => {
  const timestamp = dayjs().format("YYYY-MM-DD HH:mm:ss");
  const { patient } = req; // 🔥 ТОЛЬКО ЧЕРЕЗ resolvePatient

  if (!patient) {
    return res.status(404).json({
      success: false,
      message: "Пациент не найден",
    });
  }

  console.log(
    `[${timestamp}] 🔍 [DoplerScan] Запрос списка доплер-исследований для пациента ${patient._id}`,
  );

  try {
    const doplerScansRaw = await DoplerScan.find({
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

    const doplerScans = doplerScansRaw.map((scan) => {
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
      `[${timestamp}] ✅ Найдено доплер-исследований: ${doplerScans.length}`,
    );

    res.status(200).json({
      success: true,
      count: doplerScans.length,
      data: doplerScans,
    });
  } catch (error) {
    console.error(
      `[${timestamp}] ❌ Ошибка получения доплер-исследований:`,
      error,
    );

    res.status(500).json({
      success: false,
      message: "Ошибка при получении доплер-исследований",
      error: error.message,
    });
  }
};

export default getListDoplerScanController;
