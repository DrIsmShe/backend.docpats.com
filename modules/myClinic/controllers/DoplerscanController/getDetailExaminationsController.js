// controllers/CTscanControllers/getDetailExaminationsController.js

import DoplerScan from "../../../../common/models/Polyclinic/ExamenationsTemplates/DoplerScansTemplates/DoplerScan.js";

const getDetailExaminationsController = async (req, res) => {
  try {
    const { id } = req.params;

    const doplerScan = await DoplerScan.findById(id)
      .populate("patientId", "-__v -createdAt -updatedAt") // данные пациента
      .populate("doctor", "-password -__v") // данные врача без пароля
      .populate("reportTemplate")
      .populate("diagnosisTemplate")
      .populate("recomandationTemplate")

      .populate(
        "doctorComments.doctor",
        "firstNameEncrypted lastNameEncrypted role"
      ); // комментарии врачей

    if (!doplerScan) {
      return res.status(404).json({ message: "Исследование не найдено" });
    }

    // Расшифровка имени врача, если используется шифрование
    if (doplerScan.doctor?.decryptFields) {
      doplerScan.doctor = doplerScan.doctor.decryptFields();
    }

    // Расшифровка имен врачей в комментариях
    if (doplerScan.doctorComments?.length > 0) {
      doplerScan.doctorComments = doplerScan.doctorComments.map((comment) => {
        if (comment.doctor?.decryptFields) {
          comment.doctor = comment.doctor.decryptFields();
        }
        return comment;
      });
    }

    res.status(200).json(doplerScan);
  } catch (error) {
    console.error("Ошибка при получении Dopler-исследования:", error);
    res.status(500).json({ message: "Ошибка сервера", error: error.message });
  }
};

export default getDetailExaminationsController;
