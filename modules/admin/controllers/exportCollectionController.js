import mongoose from "mongoose";
import User from "../../../common/models/Auth/users.js";
import DoctorProfile from "../../../common/models/DoctorProfile/profileDoctor.js";
import PatientProfile from "../../../common/models/PatientProfile/patientProfile.js";
// добавляй по мере надобности

export default async function exportCollectionController(req, res) {
  try {
    const { collection } = req.params;

    // все зарегистрированные модели
    const models = mongoose.models;

    const Model = models[collection];
    if (!Model) {
      return res.status(400).json({
        message: `Модель '${collection}' не найдена`,
      });
    }

    const data = await Model.find().lean();

    res.setHeader(
      "Content-Disposition",
      `attachment; filename=${collection}.json`,
    );
    res.setHeader("Content-Type", "application/json");

    res.status(200).json(data);
  } catch (err) {
    console.error("❌ exportCollection error:", err);
    res.status(500).json({ message: "Ошибка экспорта" });
  }
}
