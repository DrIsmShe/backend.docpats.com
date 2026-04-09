import XRAYScan from "../../../../common/models/Polyclinic/ExamenationsTemplates/XRayScansTemplates/XRayScan.js";
import { decrypt } from "../../../../common/models/Auth/users.js";
import dayjs from "dayjs";

const getListXRAYScanerController = async (req, res) => {
  try {
    const patient = req.patient;

    if (!patient) {
      return res.status(404).json({ message: "Пациент не найден" });
    }

    const patientModel = patient.constructor.modelName;

    const scans = await XRAYScan.find({
      patient: patient._id,
      patientModel,
    })
      .sort({ createdAt: -1 })
      .populate("doctor");

    return res.status(200).json({
      success: true,
      count: scans.length,
      data: scans,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Ошибка получения XRAY",
      error: error.message,
    });
  }
};

export default getListXRAYScanerController;
