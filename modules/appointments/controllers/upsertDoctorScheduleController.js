// controllers/appointments/upsertDoctorScheduleController.js
import DoctorSchedule from "../../common/models/Appointment/doctorSchedule.js";

export const upsertDoctorScheduleController = async (req, res) => {
  try {
    const { doctorId } = req.params;
    const payload = req.body; // weekly, exceptions, timezone, autoApprove, priceAZN, minLeadMinutes, maxAdvanceDays ...

    const doc = await DoctorSchedule.findOneAndUpdate(
      { doctorId },
      { $set: payload },
      { new: true, upsert: true }
    );
    res.json({ success: true, schedule: doc });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
