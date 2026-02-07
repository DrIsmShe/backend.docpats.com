import newPatientMedicalHistory from "../../../common/models/Polyclinic/MedicalHistory/newPatientMedicalHistory.js";
import NewPatientPolyclinic from "../../../common/models/Polyclinic/newPatientPolyclinic.js";
import User from "../../../common/models/Auth/users.js";
import DoctorProfile from "../../../common/models/DoctorProfile/profileDoctor.js";
import { decrypt } from "../../../common/models/Auth/users.js";

const patientsMedicalHistoryGetController = async (req, res) => {
  const { id: patientId } = req.params;

  try {
    if (!patientId) {
      return res.status(400).json({
        message: "Некорректный запрос: отсутствует ID пациента",
      });
    }

    // 🏥 **Получаем историю болезни пациента с врачами (авторами записей)**
    const medicalHistory = await newPatientMedicalHistory
      .find({ patientId })
      .populate({
        path: "createdBy",
        select:
          "firstNameEncrypted lastNameEncrypted emailEncrypted _id specialization",
        populate: { path: "specialization", select: "name" }, // ✅ Загружаем название специализации
      })
      .sort({ createdAt: -1 });

    if (!medicalHistory.length) {
      return res.status(404).json({ message: "История болезни не найдена" });
    }

    // 🔍 **Расшифровка данных врачей, создавших записи в истории болезни**
    const decryptedMedicalHistory = medicalHistory.map((history) => {
      if (history.createdBy) {
        return {
          ...history.toObject(),
          createdBy: {
            ...history.createdBy.toObject(),
            firstName: decrypt(history.createdBy.firstNameEncrypted),
            lastName: decrypt(history.createdBy.lastNameEncrypted),
            email: decrypt(history.createdBy.emailEncrypted),
            specialization: history.createdBy.specialization
              ? history.createdBy.specialization.name
              : "Неизвестно", // ✅ Берём название специализации
          },
        };
      }
      return history.toObject();
    });

    // 👤 **Получаем информацию о пациенте**
    const patientInfo = await NewPatientPolyclinic.findById(patientId).select(
      "photo fullName gender age phone email address doctorId"
    );

    if (!patientInfo) {
      return res
        .status(404)
        .json({ message: "Информация о пациенте не найдена" });
    }

    // 👨‍⚕️ **Получаем информацию о ЛЕЧАЩЕМ враче пациента**
    const doctorInfo = await User.findById(patientInfo.doctorId)
      .populate("specialization", "name")
      .select(
        "username emailEncrypted firstNameEncrypted lastNameEncrypted role phoneEncrypted specialization"
      );

    const decryptedDoctorInfo = doctorInfo
      ? {
          ...doctorInfo.toObject(),
          firstName: decrypt(doctorInfo.firstNameEncrypted),
          lastName: decrypt(doctorInfo.lastNameEncrypted),
          email: decrypt(doctorInfo.emailEncrypted),
          phoneNumber: decrypt(doctorInfo.phoneEncrypted),
          specialization: doctorInfo.specialization?.name || "Неизвестно",
        }
      : null;

    // 📄 **Получаем профиль врача из модели `DoctorProfile`**
    const doctorProfileInfo = await DoctorProfile.findOne({
      userId: patientInfo.doctorId,
    }).select("company speciality clinic profileImage country phoneNumber");

    return res.status(200).json({
      patient: patientInfo,
      doctor: decryptedDoctorInfo,
      doctorSpecialization: decryptedDoctorInfo?.specialization || "Неизвестно",
      medicalHistory: decryptedMedicalHistory, // ✅ История болезни с врачами и их специализациями
      doctorProfile: doctorProfileInfo || null,
    });
  } catch (err) {
    console.error("Ошибка при получении данных пациента:", err);
    return res.status(500).json({ message: "Ошибка сервера" });
  }
};

export default patientsMedicalHistoryGetController;
