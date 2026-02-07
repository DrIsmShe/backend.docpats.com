import newPatientMedicalHistoryModel from "../../../common/models/Polyclinic/MedicalHistory/newPatientMedicalHistory.js";
import NewPatientPolyclinic from "../../../common/models/Polyclinic/newPatientPolyclinic.js";
import User from "../../../common/models/Auth/users.js"; // для метода decryptFields()

const getMyMedicalHistoryController = async (req, res) => {
  try {
    // ✅ исправлено: раньше было req.user?._id (undefined)
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: "Пользователь не авторизован",
      });
    }

    // Находим пациента по linkedUserId
    const patient = await NewPatientPolyclinic.findOne({
      linkedUserId: userId,
    });

    if (!patient) {
      return res.status(404).json({
        success: false,
        message: "Пациент не найден или не связан с этим пользователем",
      });
    }

    // Загружаем истории болезни с вложенными объектами
    const histories = await newPatientMedicalHistoryModel
      .find({ patientId: patient._id })
      .populate({
        path: "createdBy",
        select: "firstNameEncrypted lastNameEncrypted",
      })
      .populate({
        path: "doctorId",
        select: "firstNameEncrypted lastNameEncrypted specialization",
        populate: {
          path: "specialization",
          select: "name",
        },
      })
      .populate({
        path: "doctorProfileId",
        select: "position workplace",
      })
      .sort({ createdAt: -1 });

    // Дешифровка
    const result = histories.map((doc) => {
      const history = doc.toObject();

      // Дешифруем doctorId
      if (
        history.doctorId &&
        typeof doc.doctorId?.decryptFields === "function"
      ) {
        const decrypted = doc.doctorId.decryptFields();
        history.doctorId.firstName = decrypted?.firstName || null;
        history.doctorId.lastName = decrypted?.lastName || null;
      }

      // Дешифруем createdBy
      if (
        history.createdBy &&
        typeof doc.createdBy?.decryptFields === "function"
      ) {
        const decrypted = doc.createdBy.decryptFields();
        history.createdBy.firstName = decrypted?.firstName || null;
        history.createdBy.lastName = decrypted?.lastName || null;
      }

      return history;
    });

    return res.status(200).json({
      success: true,
      count: result.length,
      data: result,
    });
  } catch (error) {
    console.error("❌ Ошибка при получении историй болезни пациента:", error);
    return res.status(500).json({
      success: false,
      message: "Ошибка сервера при получении историй болезни",
    });
  }
};

export default getMyMedicalHistoryController;
