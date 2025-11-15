// modules/patientAppointments/controllers/getPatientAppointmentsHistoryController.js
import Appointment from "../../../common/models/Appointment/appointment.js";
import ProfileDoctor from "../../../common/models/DoctorProfile/profileDoctor.js";

export const getPatientAppointmentsHistoryController = async (req, res) => {
  try {
    const patientId = req.userId;

    const appointments = await Appointment.find({ patientId })
      .populate({
        path: "doctorId",
        select:
          "firstNameEncrypted lastNameEncrypted specialization country city",
      })
      .sort({ startsAt: -1 })
      .lean();

    res.status(200).json({
      success: true,
      message: "История приёмов успешно получена",
      data: appointments,
    });
  } catch (error) {
    console.error("Ошибка при получении истории:", error);
    res.status(500).json({ success: false, message: "Ошибка сервера" });
  }
};
