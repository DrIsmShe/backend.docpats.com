import CapsuleEndoscopyScan from "../../../../common/models/Polyclinic/ExamenationsTemplates/CapsuleEndoscopyScansTemplates/CapsuleEndoscopyScan.js";

const getDetailExaminationsControllerGastroscopy = async (req, res) => {
  try {
    const { id } = req.params;

    const capsuleEndoscopyScan = await CapsuleEndoscopyScan.findById(id)
      .populate("patientId", "-__v -createdAt -updatedAt") // данные пациента
      .populate("doctor", "-password -__v") // данные врача без пароля
      .populate("reportTemplate")
      .populate("diagnosisTemplate")
      .populate("recomandationTemplate")
      .populate(
        "doctorComments.doctor",
        "firstNameEncrypted lastNameEncrypted role"
      ); // комментарии врачей

    if (!capsuleEndoscopyScan) {
      return res.status(404).json({ message: "Исследование не найдено" });
    }

    // Расшифровка имени врача, если используется шифрование
    if (capsuleEndoscopyScan.doctor?.decryptFields) {
      capsuleEndoscopyScan.doctor = capsuleEndoscopyScan.doctor.decryptFields();
    }

    // Расшифровка имен врачей в комментариях
    if (capsuleEndoscopyScan.doctorComments?.length > 0) {
      capsuleEndoscopyScan.doctorComments =
        capsuleEndoscopyScan.doctorComments.map((comment) => {
          if (comment.doctor?.decryptFields) {
            comment.doctor = comment.doctor.decryptFields();
          }
          return comment;
        });
    }

    res.status(200).json(capsuleEndoscopyScan);
  } catch (error) {
    console.error("Ошибка при получении gastroscopy-исследования:", error);
    res.status(500).json({ message: "Ошибка сервера", error: error.message });
  }
};

export default getDetailExaminationsControllerGastroscopy;
