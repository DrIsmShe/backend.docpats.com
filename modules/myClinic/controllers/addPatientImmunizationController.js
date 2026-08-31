import ImmunizationPatient from "../../../common/models/Polyclinic/MedicalHistory/immunizationPatient.js";
import path from "path";

// Контроллер для создания нового пациента
const addImmunizationPatientController = async (req, res) => {
  try {
    // Проверка на наличие пользователя в сессии
    if (!req.session.userId) {
      console.log("Ошибка: пользователь не аутентифицирован.");
      return res
        .status(403)
        .json({ message: req.t("myClinic.auth.pleaseLogin") });
    }

    const patientId = req.params.id;
    const { immunization } = req.body;

    console.log("User ID из сессии:", req.session.userId);
    console.log("Полученные данные:", req.body);

    // Проверка на наличие данных
    if (!immunization || immunization.trim() === "") {
      return res.status(400).json({
        message: req.t("myClinic.field.immunization.required"),
      });
    }

    // Создание нового пациента
    const newImmunizationPatient = new ImmunizationPatient({
      doctorId: req.session.userId,
      patientId: patientId,
      content: immunization,
    });

    console.log("Сохранение пациента в базе данных...");
    await newImmunizationPatient.save();

    console.log("Пациент успешно добавлен:", newImmunizationPatient);

    return res.status(201).json({
      message: req.t("myClinic.patient.addSuccess"),
      patient: newImmunizationPatient,
    });
  } catch (error) {
    console.error("Ошибка при добавлении пациента:", error);
    return res.status(500).json({
      message: req.t("myClinic.patient.addError"),
      error: error.message,
    });
  }
};

export default addImmunizationPatientController;
