import chronicDiseasesPatient from "../../../common/models/Polyclinic/MedicalHistory/chronicDiseasesPatient.js";
import path from "path";

// Контроллер для создания нового пациента
const addPatientChronicDiseasesPatientController = async (req, res) => {
  try {
    // Проверка на наличие пользователя в сессии
    if (!req.session.userId) {
      console.log("Ошибка: пользователь не аутентифицирован.");
      return res
        .status(403)
        .json({ message: req.t("myClinic.auth.pleaseLogin") });
    }

    const patientId = req.params.id;
    const { chronicDiseases } = req.body;

    console.log("User ID из сессии:", req.session.userId);
    console.log("Полученные данные:", req.body);

    // Проверка на наличие данных о хронических заболеваниях
    if (!chronicDiseases || chronicDiseases.trim() === "") {
      return res
        .status(400)
        .json({ message: req.t("myClinic.field.chronicDiseases.required") });
    }

    // Создание нового пациента с хроническими заболеваниями
    const newchronicDiseasesPatient = new chronicDiseasesPatient({
      doctorId: req.session.userId,
      patientId: patientId,
      content: chronicDiseases,
    });

    console.log("Сохранение пациента в базе данных...");
    await newchronicDiseasesPatient.save();

    console.log("Пациент успешно добавлен:", newchronicDiseasesPatient);

    return res.status(201).json({
      message: req.t("myClinic.patient.addSuccess"),
      patient: newchronicDiseasesPatient,
    });
  } catch (error) {
    console.error("Ошибка при добавлении пациента:", error);
    return res.status(500).json({
      message: req.t("myClinic.patient.addError"),
      error: error.message,
    });
  }
};

export default addPatientChronicDiseasesPatientController;
