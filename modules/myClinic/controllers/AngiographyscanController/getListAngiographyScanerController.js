import AngiographyScan from "../../../../common/models/Polyclinic/ExamenationsTemplates/AngiographyscanTemplates/Angiographyscan.js";
import User, { decrypt } from "../../../../common/models/Auth/users.js";
import dayjs from "dayjs";

const getListAngiographyScanController = async (req, res) => {
  const { id } = req.params; // Получаем ID пациента из параметров запроса
  const timestamp = dayjs().format("YYYY-MM-DD HH:mm:ss");

  console.log(
    `[${timestamp}] 🔍 [AngiographyScan] Запрос на список HOLTER-исследований для пациента ${id}`
  );

  try {
    const angiographyScansRaw = await AngiographyScan.find({ patientId: id }) // Фильтруем по patientId
      .populate("patientId", "firstNameEncrypted lastNameEncrypted birthDate")
      .populate("doctor", "firstNameEncrypted lastNameEncrypted birthDate")
      .populate("reportTemplate")
      .populate("diagnosisTemplate")
      .populate("recomandationTemplate");

    // 🔓 Расшифровка имён и фамилий
    const angiographyScans = angiographyScansRaw.map((scan) => {
      const scanObj = scan.toObject();

      if (scanObj.doctor && scanObj.doctor.firstNameEncrypted) {
        scanObj.doctor.firstName = decrypt(scanObj.doctor.firstNameEncrypted);
        scanObj.doctor.lastName = decrypt(scanObj.doctor.lastNameEncrypted);
      }

      if (scanObj.patientId && scanObj.patientId.firstNameEncrypted) {
        scanObj.patientId.firstName = decrypt(
          scanObj.patientId.firstNameEncrypted
        );
        scanObj.patientId.lastName = decrypt(
          scanObj.patientId.lastNameEncrypted
        );
      }

      return scanObj;
    });

    console.log(
      `[${timestamp}] ✅ Получено ${angiographyScans.length} USM-исследований`
    );

    res.status(200).json({
      success: true,
      count: angiographyScans.length,
      data: angiographyScans,
      message: "Список Angiography-исследований успешно получен",
    });
  } catch (error) {
    console.error(`[${timestamp}] ❌ Ошибка получения КТ: ${error.message}`);
    res.status(500).json({
      success: false,
      message: "Ошибка при получении Angiography исследований",
      error: error.message,
    });
  }
};

export default getListAngiographyScanController;
