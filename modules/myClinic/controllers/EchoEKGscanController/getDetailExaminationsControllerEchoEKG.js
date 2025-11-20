// controllers/CTscanControllers/getDetailExaminationsController.js

import EchoEKGScan from "../../../../common/models/Polyclinic/ExamenationsTemplates/EchoEKGscanTemplates/EchoEKGscan.js";

const getDetailExaminationsControllerEchoEKG = async (req, res) => {
  try {
    const { id } = req.params;

    const echoekgScan = await EchoEKGScan.findById(id)
      .populate("patientId", "-__v -createdAt -updatedAt") // данные пациента
      .populate("doctor", "-password -__v") // данные врача без пароля
      .populate("reportTemplate")
      .populate("diagnosisTemplate")
      .populate("recomandationTemplate")

      .populate(
        "doctorComments.doctor",
        "firstNameEncrypted lastNameEncrypted role"
      ); // комментарии врачей

    if (!echoekgScan) {
      return res.status(404).json({ message: "Исследование не найдено" });
    }

    // Расшифровка имени врача, если используется шифрование
    if (echoekgScan.doctor?.decryptFields) {
      echoekgScan.doctor = echoekgScan.doctor.decryptFields();
    }

    // Расшифровка имен врачей в комментариях
    if (echoekgScan.doctorComments?.length > 0) {
      echoekgScan.doctorComments = echoekgScan.doctorComments.map((comment) => {
        if (comment.doctor?.decryptFields) {
          comment.doctor = comment.doctor.decryptFields();
        }
        return comment;
      });
    }

    res.status(200).json(echoekgScan);
  } catch (error) {
    console.error("Ошибка при получении Angiography-исследования:", error);
    res.status(500).json({ message: "Ошибка сервера", error: error.message });
  }
};

export default getDetailExaminationsControllerEchoEKG;
