// controllers/CTscanControllers/getDetailExaminationsController.js

import HOLTERScan from "../../../../common/models/Polyclinic/ExamenationsTemplates/HOLTERscanTemplates/HOLTERscan.js";
import { tReq } from "../../../../common/i18n/index.js";

const getDetailExaminationsController = async (req, res) => {
  try {
    const { id } = req.params;

    const holterScan = await HOLTERScan.findById(id)
      .populate("patientId", "-__v -createdAt -updatedAt") // данные пациента
      .populate("doctor", "-password -__v") // данные врача без пароля
      .populate("reportTemplate")
      .populate("diagnosisTemplate")
      .populate("recomandationTemplate")

      .populate(
        "doctorComments.doctor",
        "firstNameEncrypted lastNameEncrypted role"
      ); // комментарии врачей

    if (!holterScan) {
      return res.status(404).json({ message: tReq(req, "myClinic.study.notFound") });
    }

    // Расшифровка имени врача, если используется шифрование
    if (holterScan.doctor?.decryptFields) {
      holterScan.doctor = holterScan.doctor.decryptFields();
    }

    // Расшифровка имен врачей в комментариях
    if (holterScan.doctorComments?.length > 0) {
      holterScan.doctorComments = holterScan.doctorComments.map((comment) => {
        if (comment.doctor?.decryptFields) {
          comment.doctor = comment.doctor.decryptFields();
        }
        return comment;
      });
    }

    res.status(200).json(holterScan);
  } catch (error) {
    console.error("Ошибка при получении USM-исследования:", error);
    res.status(500).json({ message: tReq(req, "myClinic.server.error2"), error: error.message });
  }
};

export default getDetailExaminationsController;
