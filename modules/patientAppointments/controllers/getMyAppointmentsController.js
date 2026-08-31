// 📁 server/modules/patientAppointments/controllers/getMyAppointmentsController.js
import Appointment from "../../../common/models/Appointment/appointment.js";
import DoctorProfile from "../../../common/models/DoctorProfile/profileDoctor.js";
import User, { decrypt } from "../../../common/models/Auth/users.js";
import Specialization from "../../../common/models/DoctorProfile/specialityOfDoctor.js";
import { tReq } from "../../../common/i18n/index.js";

/**
 * Контроллер: Получение всех приёмов текущего пациента
 */
export const getMyAppointmentsController = async (req, res) => {
  try {
    const patientId = req.userId;

    if (!patientId) {
      return res.status(403).json({
        success: false,
        message: tReq(req, "app.access.patientNotAuthorized"),
      });
    }

    // 🔹 Загружаем все приёмы пациента
    const appointments = await Appointment.find({ patientId })
      .populate({
        path: "doctorId",
        model: "DoctorProfile",
        populate: {
          path: "userId",
          model: "User",
          select:
            "firstNameEncrypted lastNameEncrypted country specialization avatar",
          populate: {
            path: "specialization",
            model: "Specialization",
            select: "name",
          },
        },
      })
      .sort({ startsAt: -1 })
      .lean();

    // 🧩 Если приёмов нет
    if (!appointments.length) {
      return res.status(200).json({
        success: true,
        data: [],
        message: tReq(req, "app.patient.noAppointments"),
      });
    }

    console.log(`📋 Найдено приёмов: ${appointments.length}`);

    // 🔐 Расшифровка данных врача
    const decryptedAppointments = appointments.map((appointment) => {
      const doctorProfile = appointment.doctorId;
      const user = doctorProfile?.userId;

      if (!doctorProfile || !user) {
        return {
          ...appointment,
          doctorId: {
            userId: {
              firstName: "Доктор",
              lastName: "",
              country: "—",
            },
            specialty: "Без специализации",
            profileImage: null,
          },
        };
      }

      const firstName = user.firstNameEncrypted
        ? decrypt(user.firstNameEncrypted)
        : "Доктор";
      const lastName = user.lastNameEncrypted
        ? decrypt(user.lastNameEncrypted)
        : "";
      const country = user.country || doctorProfile.country || "Не указано";
      const specialty =
        user.specialization?.name ||
        doctorProfile.specialization?.name ||
        "Без специализации";

      return {
        ...appointment,
        doctorId: {
          ...doctorProfile,
          userId: {
            ...user,
            firstName,
            lastName,
            country,
          },
          specialty,
        },
      };
    });

    // ✅ Успешный ответ
    return res.status(200).json({
      success: true,
      count: decryptedAppointments.length,
      data: decryptedAppointments,
    });
  } catch (error) {
    console.error("❌ Ошибка при получении приёмов:", error);

    return res.status(500).json({
      success: false,
      message: tReq(req, "app.appointments.loadServerError"),
      error: error.message,
    });
  }
};
