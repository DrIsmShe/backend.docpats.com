// controllers/CTscanControllers/getDetailExaminationsController.js

import CoronographyScan from "../../../../common/models/Polyclinic/ExamenationsTemplates/CoronographyscanTemplates/Coronographyscan.js";

const getDetailExaminationsControllerCoronography = async (req, res) => {
  try {
    const { id } = req.params;

    const coronographyScan = await CoronographyScan.findById(id)
      .populate("patientId", "-__v -createdAt -updatedAt") // данные пациента
      .populate("doctor", "-password -__v") // данные врача без пароля
      .populate("reportTemplate")
      .populate("diagnosisTemplate")
      .populate("recomandationTemplate")

      .populate(
        "doctorComments.doctor",
        "firstNameEncrypted lastNameEncrypted role"
      ); // комментарии врачей

    if (!coronographyScan) {
      return res.status(404).json({ message: "Исследование не найдено" });
    }

    // Расшифровка имени врача, если используется шифрование
    if (coronographyScan.doctor?.decryptFields) {
      coronographyScan.doctor = coronographyScan.doctor.decryptFields();
    }

    // Расшифровка имен врачей в комментариях
    if (coronographyScan.doctorComments?.length > 0) {
      coronographyScan.doctorComments = coronographyScan.doctorComments.map(
        (comment) => {
          if (comment.doctor?.decryptFields) {
            comment.doctor = comment.doctor.decryptFields();
          }
          return comment;
        }
      );
    }

    res.status(200).json(coronographyScan);
  } catch (error) {
    console.error("Ошибка при получении coronographyy-исследования:", error);
    res.status(500).json({ message: "Ошибка сервера", error: error.message });
  }
};

export default getDetailExaminationsControllerCoronography;
