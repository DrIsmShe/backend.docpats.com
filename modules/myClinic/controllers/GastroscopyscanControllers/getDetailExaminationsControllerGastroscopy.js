import GastroscopyScan from "../../../../common/models/Polyclinic/ExamenationsTemplates/GastroscopyScansTemplates/GastroscopyScan.js";

const getDetailExaminationsControllerGastroscopy = async (req, res) => {
  try {
    const { id } = req.params;

    const gastroscopyScan = await GastroscopyScan.findById(id)
      .populate("patientId", "-__v -createdAt -updatedAt") // данные пациента
      .populate("doctor", "-password -__v") // данные врача без пароля
      .populate("reportTemplate")
      .populate("diagnosisTemplate")
      .populate("recomandationTemplate")
      .populate(
        "doctorComments.doctor",
        "firstNameEncrypted lastNameEncrypted role"
      ); // комментарии врачей

    if (!gastroscopyScan) {
      return res.status(404).json({ message: "Исследование не найдено" });
    }

    // Расшифровка имени врача, если используется шифрование
    if (gastroscopyScan.doctor?.decryptFields) {
      gastroscopyScan.doctor = gastroscopyScan.doctor.decryptFields();
    }

    // Расшифровка имен врачей в комментариях
    if (gastroscopyScan.doctorComments?.length > 0) {
      gastroscopyScan.doctorComments = gastroscopyScan.doctorComments.map(
        (comment) => {
          if (comment.doctor?.decryptFields) {
            comment.doctor = comment.doctor.decryptFields();
          }
          return comment;
        }
      );
    }

    res.status(200).json(gastroscopyScan);
  } catch (error) {
    console.error("Ошибка при получении gastroscopy-исследования:", error);
    res.status(500).json({ message: "Ошибка сервера", error: error.message });
  }
};

export default getDetailExaminationsControllerGastroscopy;
