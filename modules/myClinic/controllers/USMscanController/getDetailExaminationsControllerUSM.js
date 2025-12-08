// controllers/CTscanControllers/getDetailExaminationsController.js

import USMScan from "../../../../common/models/Polyclinic/ExamenationsTemplates/USMscanTemplates/USMscan.js";

const getDetailExaminationsControllerUSM = async (req, res) => {
  try {
    const { id } = req.params;

    const usmScan = await USMScan.findById(id)
      .populate("patientId", "-__v -createdAt -updatedAt") // данные пациента
      .populate("doctor", "-password -__v") // данные врача без пароля
      .populate("reportTemplate")
      .populate("diagnosisTemplate")
      .populate("recomandationTemplate")

      .populate(
        "doctorComments.doctor",
        "firstNameEncrypted lastNameEncrypted role"
      ); // комментарии врачей

    if (!usmScan) {
      return res.status(404).json({ message: "Исследование не найдено" });
    }

    // Расшифровка имени врача, если используется шифрование
    if (usmScan.doctor?.decryptFields) {
      usmScan.doctor = usmScan.doctor.decryptFields();
    }

    // Расшифровка имен врачей в комментариях
    if (usmScan.doctorComments?.length > 0) {
      usmScan.doctorComments = usmScan.doctorComments.map((comment) => {
        if (comment.doctor?.decryptFields) {
          comment.doctor = comment.doctor.decryptFields();
        }
        return comment;
      });
    }

    res.status(200).json(usmScan);
  } catch (error) {
    console.error("Ошибка при получении USM-исследования:", error);
    res.status(500).json({ message: "Ошибка сервера", error: error.message });
  }
};

export default getDetailExaminationsControllerUSM;
