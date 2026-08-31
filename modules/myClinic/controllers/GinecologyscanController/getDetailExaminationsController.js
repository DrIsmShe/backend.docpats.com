// controllers/CTscanControllers/getDetailExaminationsController.js

import GinecologyScan from "../../../../common/models/Polyclinic/ExamenationsTemplates/GinecologyTemplates/Ginecology.js";
import { tReq } from "../../../../common/i18n/index.js";

const getDetailExaminationsController = async (req, res) => {
  try {
    const { id } = req.params;

    const ginecologyScan = await GinecologyScan.findById(id)
      .populate("patientId", "-__v -createdAt -updatedAt") // данные пациента
      .populate("doctor", "-password -__v") // данные врача без пароля
      .populate("reportTemplate")
      .populate("diagnosisTemplate")
      .populate("recomandationTemplate")

      .populate(
        "doctorComments.doctor",
        "firstNameEncrypted lastNameEncrypted role"
      ); // комментарии врачей

    if (!ginecologyScan) {
      return res.status(404).json({ message: tReq(req, "myClinic.study.notFound") });
    }

    // Расшифровка имени врача, если используется шифрование
    if (ginecologyScan.doctor?.decryptFields) {
      ginecologyScan.doctor = ginecologyScan.doctor.decryptFields();
    }

    // Расшифровка имен врачей в комментариях
    if (ginecologyScan.doctorComments?.length > 0) {
      ginecologyScan.doctorComments = ginecologyScan.doctorComments.map(
        (comment) => {
          if (comment.doctor?.decryptFields) {
            comment.doctor = comment.doctor.decryptFields();
          }
          return comment;
        }
      );
    }

    res.status(200).json(ginecologyScan);
  } catch (error) {
    console.error("Ошибка при получении ginecology-исследования:", error);
    res.status(500).json({ message: tReq(req, "myClinic.server.error2"), error: error.message });
  }
};

export default getDetailExaminationsController;
