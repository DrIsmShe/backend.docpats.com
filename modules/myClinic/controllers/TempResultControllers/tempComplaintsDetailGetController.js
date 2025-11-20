import TempComplaints from "../../../../common/models/Polyclinic/TempResults/tempComplaints.js";
import mongoose from "mongoose";
const tempComplaintsDetailGetController = async (req, res) => {
  try {
    const { id: _id } = req.params;

    // Проверяем, является ли переданный id валидным ObjectId
    if (!mongoose.Types.ObjectId.isValid(_id)) {
      return res.status(400).json({ message: "Invalid complaint ID" });
    }

    // Ищем запись в базе данных по ID
    const complaint = await TempComplaints.findById(_id);

    // Если запись не найдена, отправляем 404
    if (!complaint) {
      return res.status(404).json({ message: "Complaint template not found" });
    }

    // Отправляем найденную запись в ответе
    res.status(200).json(complaint);
  } catch (error) {
    // Логируем ошибку и отправляем сообщение об ошибке
    console.error("Error fetching complaint template:", error);
    res.status(500).json({ message: "Server error. Please try again later." });
  }
};

export default tempComplaintsDetailGetController;
