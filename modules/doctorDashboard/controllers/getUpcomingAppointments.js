import mongoose from "mongoose";
import Appointment from "../../../common/models/Appointment/appointment.js";
import ProfileDoctor from "../../../common/models/DoctorProfile/profileDoctor.js";

export const getUpcomingAppointments = async (req, res) => {
  try {
    const userId = req.userId;
    const profile = await ProfileDoctor.findOne({ userId }).lean();

    if (!profile)
      return res.status(404).json({
        success: false,
        message: "Профиль врача не найден",
      });

    const doctorObjectId = new mongoose.Types.ObjectId(profile._id);
    const now = new Date();
    const in30min = new Date(now.getTime() + 30 * 60 * 1000);

    const upcoming = await Appointment.find({
      doctorId: doctorObjectId,
      status: "confirmed",
      startsAt: { $gte: now, $lte: in30min },
    })
      .populate("patientId", "firstNameEncrypted lastNameEncrypted")
      .lean();

    res.json({ success: true, data: upcoming });
  } catch (err) {
    console.error("❌ Ошибка getUpcomingAppointments:", err);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};
