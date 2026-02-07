// modules/patientAppointments/controllers/getPatientAppointmentsHistoryController.js

import Appointment from "../../../common/models/Appointment/appointment.js";

export const getPatientAppointmentsHistoryController = async (req, res) => {
  try {
    const patientId = req.userId;

    const appointments = await Appointment.find({ patientId })
      // 🔹 Профиль врача (специализация, локация)
      .populate({
        path: "doctorId",
        select: "specialization country city",
      })
      // 🔹 Пользователь (имя, фамилия врача)
      .populate({
        path: "doctorIdUser",
        select: "firstNameEncrypted lastNameEncrypted",
      })
      .sort({ startsAt: -1 });

    // 🔥 Расшифровка имени врача
    appointments.forEach((app) => {
      if (app.doctorIdUser?.decryptFields) {
        app.doctorIdUser.decryptFields();
      }
    });

    res.status(200).json({
      success: true,
      message: "История приёмов успешно получена",
      data: appointments,
    });
  } catch (error) {
    console.error("Ошибка при получении истории:", error);
    res.status(500).json({
      success: false,
      message: "Ошибка сервера",
    });
  }
};
