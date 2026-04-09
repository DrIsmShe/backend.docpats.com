import mongoose from "mongoose";
import newPatientMedicalHistoryModel from "../../../common/models/Polyclinic/MedicalHistory/newPatientMedicalHistory.js";
import NewPatientPolyclinic from "../../../common/models/Polyclinic/newPatientPolyclinic.js";

const getMyMedicalHistoryController = async (req, res) => {
  try {
    const userId = req.user?.userId;
    const role = req.user?.role;

    if (!userId || role !== "patient") {
      return res.status(401).json({
        success: false,
        message: "Доступ разрешён только зарегистрированным пациентам",
      });
    }

    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({
        success: false,
        message: "Некорректный userId",
      });
    }

    const objectUserId = new mongoose.Types.ObjectId(userId);

    // ✅ ИЩЕМ ПРОСТО ПО linkedUserId
    const patient = await NewPatientPolyclinic.findOne({
      linkedUserId: objectUserId,
      isDeleted: false,
    }).select("_id");

    if (!patient) {
      return res.status(404).json({
        success: false,
        message: "Профиль пациента не найден",
      });
    }

    const histories = await newPatientMedicalHistoryModel
      .find({
        patientRef: patient._id,
        patientTypeModel: "NewPatientPolyclinic",
      })
      .populate("createdBy")
      .populate({
        path: "doctorId",
        populate: { path: "specialization" },
      })
      .populate("doctorProfileId")
      .sort({ createdAt: -1 });

    return res.status(200).json({
      success: true,
      count: histories.length,
      data: histories,
    });
  } catch (error) {
    console.error("❌ getMyMedicalHistoryController error:", error);

    return res.status(500).json({
      success: false,
      message: "Ошибка сервера при получении историй болезни",
    });
  }
};

export default getMyMedicalHistoryController;
