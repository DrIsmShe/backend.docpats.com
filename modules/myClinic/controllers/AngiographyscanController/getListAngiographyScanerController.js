import AngiographyScan from "../../../../common/models/Polyclinic/ExamenationsTemplates/AngiographyscanTemplates/Angiographyscan.js";
import User, { decrypt } from "../../../../common/models/Auth/users.js";
import dayjs from "dayjs";

const getListAngiographyScanController = async (req, res) => {
  const timestamp = dayjs().format("YYYY-MM-DD HH:mm:ss");
  const { patient } = req; // 🔥 ВАЖНО — resolvePatient кладёт сюда пациента

  console.log(
    `[${timestamp}] 🔍 [AngiographyScan] Запрос списка для пациента ${patient?._id}`,
  );

  try {
    if (!patient) {
      return res.status(404).json({
        success: false,
        message: "Пациент не найден",
      });
    }

    const angiographyScansRaw = await AngiographyScan.find({
      patient: patient._id,
      patientModel: patient.constructor.modelName,
    })
      .populate("doctor", "firstNameEncrypted lastNameEncrypted birthDate")
      .populate("reportTemplate")
      .populate("diagnosisTemplate")
      .populate("recomandationTemplate");

    const angiographyScans = angiographyScansRaw.map((scan) => {
      const scanObj = scan.toObject();

      if (scanObj.doctor?.firstNameEncrypted) {
        scanObj.doctor.firstName = decrypt(scanObj.doctor.firstNameEncrypted);
        scanObj.doctor.lastName = decrypt(scanObj.doctor.lastNameEncrypted);
      }

      return scanObj;
    });

    console.log(
      `[${timestamp}] ✅ Найдено ${angiographyScans.length} исследований`,
    );

    res.status(200).json({
      success: true,
      count: angiographyScans.length,
      data: angiographyScans,
    });
  } catch (error) {
    console.error(
      `[${timestamp}] ❌ Ошибка получения Angiography: ${error.message}`,
    );

    res.status(500).json({
      success: false,
      message: "Ошибка при получении Angiography исследований",
      error: error.message,
    });
  }
};

export default getListAngiographyScanController;
