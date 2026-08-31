// controllers/CTscanControllers/getDetailExaminationsController.js

import XRAYScans from "../../../../common/models/Polyclinic/ExamenationsTemplates/XRayScansTemplates/XRayScan.js";
import { tReq } from "../../../../common/i18n/index.js";

const getDetailExaminationsController = async (req, res) => {
  try {
    const { id } = req.params;

    const xrayScan = await XRAYScans.findById(id)
      .populate("patientId", "-__v -createdAt -updatedAt") // данные пациента
      .populate("doctor", "-password -__v") // данные врача без пароля
      .populate("reportTemplate")
      .populate("diagnosisTemplate")
      .populate("recomandationTemplate")

      .populate(
        "doctorComments.doctor",
        "firstNameEncrypted lastNameEncrypted role"
      ); // комментарии врачей

    if (!xrayScan) {
      return res.status(404).json({ message: tReq(req, "myClinic.study.notFound") });
    }

    // Расшифровка имени врача, если используется шифрование
    if (xrayScan.doctor?.decryptFields) {
      xrayScan.doctor = xrayScan.doctor.decryptFields();
    }

    // Расшифровка имен врачей в комментариях
    if (xrayScan.doctorComments?.length > 0) {
      xrayScan.doctorComments = xrayScan.doctorComments.map((comment) => {
        if (comment.doctor?.decryptFields) {
          comment.doctor = comment.doctor.decryptFields();
        }
        return comment;
      });
    }

    res.status(200).json(xrayScan);
  } catch (error) {
    console.error("Ошибка при получении XRAY-исследования:", error);
    res.status(500).json({ message: tReq(req, "myClinic.server.error2"), error: error.message });
  }
};

export default getDetailExaminationsController;
