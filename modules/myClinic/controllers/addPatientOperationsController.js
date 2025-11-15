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
        .json({ message: "Пожалуйста, войдите в систему." });
    }

    const patientId = req.params.id;
    const { operations } = req.body;

    console.log("User ID из сессии:", req.session.userId);
    console.log("Полученные данные:", req.body);

    // Проверка на наличие данных
    if (!operations || operations.trim() === "") {
      return res.status(400).json({
        message: "Поле 'operations' не может быть пустым.",
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
      message: "Данные об операциях успешно добавлены!",
      patient: newPatientOperations,
    });
  } catch (error) {
    console.error("Ошибка при добавлении данных об операциях:", error);
    return res.status(500).json({
      message: "Произошла ошибка при добавлении данных об операциях.",
      error: error.message,
    });
  }
};

export default addPatientOperationsController;
