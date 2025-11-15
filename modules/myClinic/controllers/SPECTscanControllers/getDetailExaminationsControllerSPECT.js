// controllers/CTscanControllers/getDetailExaminationsController.js

import SPECTScan from "../../../../common/models/Polyclinic/ExamenationsTemplates/SPECTScansTemplates/SPECTScan.js";

const getDetailExaminationsControllerSPECT = async (req, res) => {
  try {
    const { id } = req.params;

    const spectScan = await SPECTScan.findById(id)
      .populate("patientId", "-__v -createdAt -updatedAt") // данные пациента
      .populate("doctor", "-password -__v") // данные врача без пароля
      .populate("reportTemplate")
      .populate("diagnosisTemplate")
      .populate("recomandationTemplate")

      .populate(
        "doctorComments.doctor",
        "firstNameEncrypted lastNameEncrypted role"
      ); // комментарии врачей

    if (!spectScan) {
      return res.status(404).json({ message: "Исследование не найдено" });
    }

    // Расшифровка имени врача, если используется шифрование
    if (spectScan.doctor?.decryptFields) {
      spectScan.doctor = spectScan.doctor.decryptFields();
    }

    // Расшифровка имен врачей в комментариях
    if (spectScan.doctorComments?.length > 0) {
      spectScan.doctorComments = spectScan.doctorComments.map((comment) => {
        if (comment.doctor?.decryptFields) {
          comment.doctor = comment.doctor.decryptFields();
        }
        return comment;
      });
    }

    res.status(200).json(spectScan);
  } catch (error) {
    console.error("Ошибка при получении SPECT-исследования:", error);
    res.status(500).json({ message: "Ошибка сервера", error: error.message });
  }
};

export default getDetailExaminationsControllerSPECT;
