import USMScans from "../../../../common/models/Polyclinic/ExamenationsTemplates/USMscanTemplates/USMscan.js";
import User, { decrypt } from "../../../../common/models/Auth/users.js";
import dayjs from "dayjs";

const getListUSMScanerController = async (req, res) => {
  const { id } = req.params; // Получаем ID пациента из параметров запроса
  const timestamp = dayjs().format("YYYY-MM-DD HH:mm:ss");

  console.log(
    `[${timestamp}] 🔍 [CTScan] Запрос на список КТ-исследований для пациента ${id}`
  );

  try {
    const usmtScansRaw = await USMScans.find({ patientId: id }) // Фильтруем по patientId
      .populate("patientId", "firstNameEncrypted lastNameEncrypted birthDate")
      .populate("doctor", "firstNameEncrypted lastNameEncrypted birthDate")
      .populate("reportTemplate")
      .populate("diagnosisTemplate")
      .populate("recomandationTemplate");

    // 🔓 Расшифровка имён и фамилий
    const usmScans = usmtScansRaw.map((scan) => {
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
      `[${timestamp}] ✅ Получено ${usmScans.length} USM-исследований`
    );

    res.status(200).json({
      success: true,
      count: usmScans.length,
      data: usmScans,
      message: "Список USM-исследований успешно получен",
    });
  } catch (error) {
    console.error(`[${timestamp}] ❌ Ошибка получения КТ: ${error.message}`);
    res.status(500).json({
      success: false,
      message: "Ошибка при получении USM исследований",
      error: error.message,
    });
  }
};

export default getListUSMScanerController;
