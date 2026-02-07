// controllers/CTscanControllers/getDetailExaminationsController.js

import SpirometryScan from "../../../../common/models/Polyclinic/ExamenationsTemplates/SpirometryScansTemplates/SpirometryScan.js";

const getDetailExaminationsController = async (req, res) => {
  try {
    const { id } = req.params;

    const spirometryScan = await SpirometryScan.findById(id)
      .populate("patientId", "-__v -createdAt -updatedAt") // данные пациента
      .populate("doctor", "-password -__v") // данные врача без пароля
      .populate("reportTemplate")
      .populate("diagnosisTemplate")
      .populate("recomandationTemplate")

      .populate(
        "doctorComments.doctor",
        "firstNameEncrypted lastNameEncrypted role"
      ); // комментарии врачей

    if (!spirometryScan) {
      return res.status(404).json({ message: "Исследование не найдено" });
    }

    // Расшифровка имени врача, если используется шифрование
    if (spirometryScan.doctor?.decryptFields) {
      spirometryScan.doctor = spirometryScan.doctor.decryptFields();
    }

    // Расшифровка имен врачей в комментариях
    if (spirometryScan.doctorComments?.length > 0) {
      spirometryScan.doctorComments = spirometryScan.doctorComments.map(
        (comment) => {
          if (comment.doctor?.decryptFields) {
            comment.doctor = comment.doctor.decryptFields();
          }
          return comment;
        }
      );
    }

    res.status(200).json(spirometryScan);
  } catch (error) {
    console.error("Ошибка при получении исследования:", error);
    res.status(500).json({ message: "Ошибка сервера", error: error.message });
  }
};

export default getDetailExaminationsController;
