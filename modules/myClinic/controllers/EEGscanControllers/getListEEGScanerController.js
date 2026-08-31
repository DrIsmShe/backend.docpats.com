import EEGScan from "../../../../common/models/Polyclinic/ExamenationsTemplates/EEGScansTemplates/EEGScan.js";
import { decrypt } from "../../../../common/models/Auth/users.js";
import dayjs from "dayjs";
import { tReq } from "../../../../common/i18n/index.js";

const getListEEGScanerController = async (req, res) => {
  const timestamp = dayjs().format("YYYY-MM-DD HH:mm:ss");
  const { patient } = req; // 🔥 ТОЛЬКО ТАК

  if (!patient) {
    return res.status(404).json({
      success: false,
      message: tReq(req, "myClinic.patient.notFound2"),
    });
  }

  console.log(
    `[${timestamp}] 🔍 [EEGScan] Запрос списка EEG для пациента ${patient._id}`,
  );

  try {
    const eegScansRaw = await EEGScan.find({
      patient: patient._id, // ✅ ЕДИНСТВЕННЫЙ ПРАВИЛЬНЫЙ ФИЛЬТР
    })
      .sort({ createdAt: -1 })
      .populate("patient", "firstNameEncrypted lastNameEncrypted birthDate")
      .populate(
        "doctor",
        "firstNameEncrypted lastNameEncrypted birthDate specialization",
      )
      .populate("reportTemplate")
      .populate("diagnosisTemplate")
      .populate("recomandationTemplate");

    const eegScans = eegScansRaw.map((scan) => {
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
      `[${timestamp}] ✅ Найдено EEG-исследований: ${eegScans.length}`,
    );

    res.status(200).json({
      success: true,
      count: eegScans.length,
      data: eegScans,
      message: tReq(req, "myClinic.study.eeg.fetchSuccess"),
    });
  } catch (error) {
    console.error(`[${timestamp}] ❌ Ошибка получения EEG:`, error);
    res.status(500).json({
      success: false,
      message: tReq(req, "myClinic.study.eeg.fetchError"),
      error: error.message,
    });
  }
};

export default getListEEGScanerController;
