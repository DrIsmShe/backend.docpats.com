import CTScan from "../../../../common/models/Polyclinic/ExamenationsTemplates/CTScansTemplates/CTScan.js";
import File from "../../../../common/models/file.js";

const getDetailExaminationsController = async (req, res) => {
  try {
    const { id } = req.params;

    // 🔍 1. Получаем без populate (для проверки)
    const ctScan = await CTScan.findById(id);

    if (!ctScan) {
      return res.status(404).json({ message: "Исследование не найдено" });
    }

    // 🔒 2. ПРОВЕРКА ДОСТУПА
    if (req.user.role === "patient") {
      if (!req.user.patientPolyclinicId) {
        return res.status(403).json({
          message: "Нет профиля пациента в поликлинике",
        });
      }

      if (
        ctScan.patientId.toString() !== req.user.patientPolyclinicId.toString()
      ) {
        return res.status(403).json({
          message: "Доступ запрещен",
        });
      }
    }

    // 🔄 3. Теперь делаем populate
    const populatedScan = await CTScan.findById(id)
      .populate("patientId", "-__v -createdAt -updatedAt")
      .populate("doctor", "-password -__v")
      .populate("reportTemplate")
      .populate("diagnosisTemplate")
      .populate("recomandationTemplate")
      .populate(
        "doctorComments.doctor",
        "firstNameEncrypted lastNameEncrypted role",
      );

    // 🧠 4. Расшифровка врача
    if (populatedScan.doctor?.decryptFields) {
      populatedScan.doctor = populatedScan.doctor.decryptFields();
    }

    // 🧠 5. Расшифровка комментариев
    if (populatedScan.doctorComments?.length > 0) {
      populatedScan.doctorComments = populatedScan.doctorComments.map(
        (comment) => {
          if (comment.doctor?.decryptFields) {
            comment.doctor = comment.doctor.decryptFields();
          }
          return comment;
        },
      );
    }

    // 📎 6. Файлы
    const files = await File.find({
      studyReference: populatedScan._id,
      studyTypeReference: "CTScan",
    }).sort({ createdAt: -1 });

    // 📤 7. Ответ
    res.status(200).json({
      ...populatedScan.toObject(),
      files,
    });
  } catch (error) {
    console.error("Ошибка при получении исследования:", error);

    res.status(500).json({
      message: "Ошибка сервера",
      error: error.message,
    });
  }
};

export default getDetailExaminationsController;
