// controllers/CTscanControllers/getDetailExaminationsController.js

import AngiographyScan from "../../../../common/models/Polyclinic/ExamenationsTemplates/AngiographyscanTemplates/Angiographyscan.js";

const getDetailExaminationsControllerAngiography = async (req, res) => {
  try {
    const { id } = req.params;

    const angiographyScan = await AngiographyScan.findById(id)
      .populate("patientId", "-__v -createdAt -updatedAt") // данные пациента
      .populate("doctor", "-password -__v") // данные врача без пароля
      .populate("reportTemplate")
      .populate("diagnosisTemplate")
      .populate("recomandationTemplate")

      .populate(
        "doctorComments.doctor",
        "firstNameEncrypted lastNameEncrypted role"
      ); // комментарии врачей

    if (!angiographyScan) {
      return res.status(404).json({ message: "Исследование не найдено" });
    }

    // Расшифровка имени врача, если используется шифрование
    if (angiographyScan.doctor?.decryptFields) {
      angiographyScan.doctor = angiographyScan.doctor.decryptFields();
    }

    // Расшифровка имен врачей в комментариях
    if (angiographyScan.doctorComments?.length > 0) {
      angiographyScan.doctorComments = angiographyScan.doctorComments.map(
        (comment) => {
          if (comment.doctor?.decryptFields) {
            comment.doctor = comment.doctor.decryptFields();
          }
          return comment;
        }
      );
    }

    res.status(200).json(angiographyScan);
  } catch (error) {
    console.error("Ошибка при получении Angiography-исследования:", error);
    res.status(500).json({ message: "Ошибка сервера", error: error.message });
  }
};

export default getDetailExaminationsControllerAngiography;
