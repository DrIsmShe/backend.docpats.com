import EKGScan from "../../../../common/models/Polyclinic/ExamenationsTemplates/EKGscanTemplates/EKGscan.js";
import User, { decrypt } from "../../../../common/models/Auth/users.js";
import dayjs from "dayjs";

const getListEKGScanController = async (req, res) => {
  const { id } = req.params; // Получаем ID пациента из параметров запроса
  const timestamp = dayjs().format("YYYY-MM-DD HH:mm:ss");

  console.log(
    `[${timestamp}] 🔍 [AngiographyScan] Запрос на список EKG-исследований для пациента ${id}`
  );

  try {
    const ekgScansRaw = await EKGScan.find({ patientId: id }) // Фильтруем по patientId
      .populate("patientId", "firstNameEncrypted lastNameEncrypted birthDate")
      .populate("doctor", "firstNameEncrypted lastNameEncrypted birthDate")
      .populate("reportTemplate")
      .populate("diagnosisTemplate")
      .populate("recomandationTemplate");

    // 🔓 Расшифровка имён и фамилий
    const ekgScans = ekgScansRaw.map((scan) => {
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
      `[${timestamp}] ✅ Получено ${ekgScans.length} USM-исследований`
    );

    res.status(200).json({
      success: true,
      count: ekgScans.length,
      data: ekgScans,
      message: "Список EKG-исследований успешно получен",
    });
  } catch (error) {
    console.error(`[${timestamp}] ❌ Ошибка получения КТ: ${error.message}`);
    res.status(500).json({
      success: false,
      message: "Ошибка при получении EKG исследований",
      error: error.message,
    });
  }
};

export default getListEKGScanController;
