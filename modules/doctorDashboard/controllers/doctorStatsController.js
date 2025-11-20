import mongoose from "mongoose";
import Appointment from "../../../common/models/Appointment/appointment.js";
import AppointmentAudit from "../../../common/models/Appointment/appointmentAudit.js";
import ProfileDoctor from "../../../common/models/DoctorProfile/profileDoctor.js";

export const getDoctorStats = async (req, res) => {
  try {
    const userId = req.userId;
    const profile = await ProfileDoctor.findOne({ userId }).lean();
    if (!profile) {
      return res.status(404).json({
        success: false,
        message: "Профиль врача не найден",
      });
    }

    const doctorObjectId = new mongoose.Types.ObjectId(profile._id);
    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const stats = await Appointment.aggregate([
      {
        $match: {
          doctorId: doctorObjectId,
          startsAt: { $gte: weekAgo },
        },
      },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
        },
      },
    ]);

    const total = stats.reduce((acc, s) => acc + s.count, 0);

    const auditCount = await AppointmentAudit.countDocuments({
      byUserId: new mongoose.Types.ObjectId(userId),
    });

    return res.json({
      success: true,
      total,
      stats,
      auditCount,
    });
  } catch (err) {
    console.error("❌ Ошибка getDoctorStats:", err);
    res.status(500).json({
      success: false,
      message: err.message,
    });
  }
};
