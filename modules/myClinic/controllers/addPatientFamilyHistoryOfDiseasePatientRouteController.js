import FamilyHistoryOfDiseasePatient from "../../../common/models/Polyclinic/MedicalHistory/familyHistoryOfDiseasePatient.js";
import path from "path";

// Контроллер для создания нового пациента
const addPatientFamilyHistoryOfDiseasePatientRouteController = async (
  req,
  res
) => {
  try {
    // Проверка на наличие пользователя в сессии
    if (!req.session.userId) {
      console.log("Ошибка: пользователь не аутентифицирован.");
      return res
        .status(403)
        .json({ message: "Пожалуйста, войдите в систему." });
    }
    const patientId = req.params.id;
    const { familyHistoryOfDisease } = req.body;

    console.log("User ID из сессии:", req.session.userId);
    console.log("Полученные данные:", req.body);

    // Проверка на наличие данных
    if (!familyHistoryOfDisease || familyHistoryOfDisease.trim() === "") {
      return res.status(400).json({
        message: "Поле 'familyHistoryOfDisease' не может быть пустым.",
      });
    }

    // Создание нового пациента
    const newFamilyHistoryOfDiseasePatient = new FamilyHistoryOfDiseasePatient({
      doctorId: req.session.userId,
      patientId: patientId,
      content: familyHistoryOfDisease,
    });

    console.log("Сохранение пациента в базе данных...");
    await newFamilyHistoryOfDiseasePatient.save();

    console.log("Пациент успешно добавлен:", newFamilyHistoryOfDiseasePatient);

    return res.status(201).json({
      message: "Пациент успешно добавлен!",
      patient: newFamilyHistoryOfDiseasePatient,
    });
  } catch (error) {
    console.error("Ошибка при добавлении пациента:", error);
    return res.status(500).json({
      message: "Произошла ошибка при добавлении пациента.",
      error: error.message,
    });
  }
};

export default addPatientFamilyHistoryOfDiseasePatientRouteController;
