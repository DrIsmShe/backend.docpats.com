// controllers/CTscanControllers/getDetailExaminationsController.js

import EKGScan from "../../../../common/models/Polyclinic/ExamenationsTemplates/EKGscanTemplates/EKGscan.js";
import { tReq } from "../../../../common/i18n/index.js";
import { errorText } from "../../../../common/i18n/index.js";

const getDetailExaminationsControllerEKG = async (req, res) => {
  try {
    const { id } = req.params;

    const ekgScan = await EKGScan.findById(id)
      .populate("patientId", "-__v -createdAt -updatedAt") // данные пациента
      .populate("doctor", "-password -__v") // данные врача без пароля
      .populate("reportTemplate")
      .populate("diagnosisTemplate")
      .populate("recomandationTemplate")

      .populate(
        "doctorComments.doctor",
        "firstNameEncrypted lastNameEncrypted role"
      ); // комментарии врачей

    if (!ekgScan) {
      return res.status(404).json({ message: tReq(req, "myClinic.study.notFound") });
    }

    // Расшифровка имени врача, если используется шифрование
    if (ekgScan.doctor?.decryptFields) {
      ekgScan.doctor = ekgScan.doctor.decryptFields();
    }

    // Расшифровка имен врачей в комментариях
    if (ekgScan.doctorComments?.length > 0) {
      ekgScan.doctorComments = ekgScan.doctorComments.map((comment) => {
        if (comment.doctor?.decryptFields) {
          comment.doctor = comment.doctor.decryptFields();
        }
        return comment;
      });
    }

    res.status(200).json(ekgScan);
  } catch (error) {
    console.error("Ошибка при получении Angiography-исследования:", error);
    res.status(500).json({ message: tReq(req, "myClinic.server.error2"), error: errorText(error, req) });
  }
};

export default getDetailExaminationsControllerEKG;
