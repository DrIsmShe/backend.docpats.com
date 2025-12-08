// controllers/CTscanControllers/getDetailExaminationsController.js

import CTScan from "../../../../common/models/Polyclinic/ExamenationsTemplates/CTScansTemplates/CTScan.js";

const getDetailExaminationsController = async (req, res) => {
  try {
    const { id } = req.params;

    const ctScan = await CTScan.findById(id)
      .populate("patientId", "-__v -createdAt -updatedAt") // данные пациента
      .populate("doctor", "-password -__v") // данные врача без пароля
      .populate("reportTemplate")
      .populate("diagnosisTemplate")
      .populate("recomandationTemplate")

      .populate(
        "doctorComments.doctor",
        "firstNameEncrypted lastNameEncrypted role"
      ); // комментарии врачей

    if (!ctScan) {
      return res.status(404).json({ message: "Исследование не найдено" });
    }

    // Расшифровка имени врача, если используется шифрование
    if (ctScan.doctor?.decryptFields) {
      ctScan.doctor = ctScan.doctor.decryptFields();
    }

    // Расшифровка имен врачей в комментариях
    if (ctScan.doctorComments?.length > 0) {
      ctScan.doctorComments = ctScan.doctorComments.map((comment) => {
        if (comment.doctor?.decryptFields) {
          comment.doctor = comment.doctor.decryptFields();
        }
        return comment;
      });
    }

    res.status(200).json(ctScan);
  } catch (error) {
    console.error("Ошибка при получении исследования:", error);
    res.status(500).json({ message: "Ошибка сервера", error: error.message });
  }
};

export default getDetailExaminationsController;
