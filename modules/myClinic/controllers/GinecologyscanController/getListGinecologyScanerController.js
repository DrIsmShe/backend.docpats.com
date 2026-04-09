import GinecologyScan from "../../../../common/models/Polyclinic/ExamenationsTemplates/GinecologyTemplates/Ginecology.js";
import { decrypt } from "../../../../common/models/Auth/users.js";
import dayjs from "dayjs";

const getListGinecologyScanerController = async (req, res) => {
  const timestamp = dayjs().format("YYYY-MM-DD HH:mm:ss");
  const { patient } = req; // 🔥 ТОЛЬКО ЧЕРЕЗ resolvePatient

  if (!patient) {
    return res.status(404).json({
      success: false,
      message: "Пациент не найден",
    });
  }

  console.log(
    `[${timestamp}] 🔍 [Ginecology] Запрос списка Ginecology для пациента ${patient._id}`,
  );

  try {
    const ginecologyScansRaw = await GinecologyScan.find({
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

    const ginecologyScans = ginecologyScansRaw.map((scan) => {
      const scanObj = scan.toObject();

      // 🔓 Доктор
      if (scanObj.doctor?.firstNameEncrypted) {
        scanObj.doctor.firstName = decrypt(scanObj.doctor.firstNameEncrypted);
        scanObj.doctor.lastName = decrypt(scanObj.doctor.lastNameEncrypted);
      }

      // 🔓 Пациент
      if (scanObj.patient?.firstNameEncrypted) {
        scanObj.patient.firstName = decrypt(scanObj.patient.firstNameEncrypted);
        scanObj.patient.lastName = decrypt(scanObj.patient.lastNameEncrypted);
      }

      return scanObj;
    });

    console.log(
      `[${timestamp}] ✅ Найдено Ginecology-исследований: ${ginecologyScans.length}`,
    );

    res.status(200).json({
      success: true,
      count: ginecologyScans.length,
      data: ginecologyScans,
      message: "Список ginecology-исследований успешно получен",
    });
  } catch (error) {
    console.error(
      `[${timestamp}] ❌ Ошибка получения Ginecology исследований:`,
      error,
    );
    res.status(500).json({
      success: false,
      message: "Ошибка при получении ginecology исследований",
      error: error.message,
    });
  }
};

export default getListGinecologyScanerController;
