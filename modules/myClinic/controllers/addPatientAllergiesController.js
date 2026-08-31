import allergiesPatient from "../../../common/models/Polyclinic/MedicalHistory/allergiesPatient.js";
import path from "path";
import { tReq } from "../../../common/i18n/index.js";

const addpatientAllergiesController = async (req, res) => {
  try {
    if (!req.session.userId) {
      return res
        .status(403)
        .json({ message: tReq(req, "myClinic.auth.pleaseLogin") });
    }

    const patientId = req.params.id;
    const { allergies } = req.body;

    console.log("User ID из сессии:", req.session.userId);
    console.log("Полученные данные:", req.body);

    if (!allergies || allergies.trim() === "") {
      return res
        .status(400)
        .json({ message: tReq(req, "myClinic.field.allergies.required") });
    }

    const newallergiesPatient = new allergiesPatient({
      doctorId: req.session.userId,
      patientId: patientId,
      content: allergies,
    });

    await newallergiesPatient.save();
    return res.status(201).json({
      message: tReq(req, "myClinic.patient.addSuccess"),
      patient: newallergiesPatient,
    });
  } catch (error) {
    console.error("Ошибка при добавлении пациента:", error);
    return res.status(500).json({
      message: tReq(req, "myClinic.patient.addError"),
      error: error.message,
    });
  }
};

export default addpatientAllergiesController;
