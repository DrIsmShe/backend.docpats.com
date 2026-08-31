import PatientOperations from "../../models/polyclinic/operationsPatient.js";
import path from "path";

// Контроллер для добавления данных об операциях пациента
const addPatientOperationsController = async (req, res) => {
  try {
    // Проверка на наличие пользователя в сессии
    if (!req.session.userId) {
      console.log("Ошибка: пользователь не аутентифицирован.");
      return res
        .status(403)
        .json({ message: req.t("myClinic.auth.pleaseLogin") });
    }

    const patientId = req.params.id;
    const { operations } = req.body;

    console.log("User ID из сессии:", req.session.userId);
    console.log("Полученные данные:", req.body);

    // Проверка на наличие данных
    if (!operations || operations.trim() === "") {
      return res.status(400).json({
        message: req.t("myClinic.field.operations.required"),
      });
    }

    // Создание нового пациента с операциями
    const newPatientOperations = new PatientOperations({
      doctorId: req.session.userId,
      patientId: patientId,
      content: operations,
    });

    console.log("Сохранение данных об операциях пациента в базе данных...");
    await newPatientOperations.save();

    console.log("Данные успешно добавлены:", newPatientOperations);

    return res.status(201).json({
      message: req.t("myClinic.operations.addSuccess"),
      patient: newPatientOperations,
    });
  } catch (error) {
    console.error("Ошибка при добавлении данных об операциях:", error);
    return res.status(500).json({
      message: req.t("myClinic.operations.addError"),
      error: error.message,
    });
  }
};

export default addPatientOperationsController;
