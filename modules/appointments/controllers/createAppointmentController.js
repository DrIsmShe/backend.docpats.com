// controllers/appointments/createAppointmentController.js
import mongoose from "mongoose";
import Appointment from "../../../common/models/Appointment/appointment.js";
import DoctorSchedule from "../../../common/models/Appointment/doctorSchedule.js";
import AppointmentAudit from "../../../common/models/Appointment/appointmentAudit.js";

function uniqueKey(doctorId, startsAt, endsAt) {
  return `${doctorId}_${startsAt.toISOString()}_${endsAt.toISOString()}`;
}

export const createAppointmentController = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const {
      doctorId,
      patientId,
      startsAt,
      endsAt,
      type = "offline",
      notesPatient,
    } = req.body;
    const starts = new Date(startsAt);
    const ends = new Date(endsAt);
    if (
      !doctorId ||
      !patientId ||
      isNaN(+starts) ||
      isNaN(+ends) ||
      starts >= ends
    ) {
      return res
        .status(400)
        .json({ success: false, message: "Invalid payload" });
    }

    const schedule = await DoctorSchedule.findOne({ doctorId }).session(
      session,
    );
    if (!schedule) {
      return res
        .status(400)
        .json({ success: false, message: "Doctor has no schedule" });
    }

    // lead time / advance windows
    const now = new Date();
    if (starts < new Date(now.getTime() + schedule.minLeadMinutes * 60000)) {
      return res
        .status(400)
        .json({ success: false, message: "Too soon to book" });
    }
    const maxAdvance = new Date(
      now.getTime() + schedule.maxAdvanceDays * 86400000,
    );
    if (starts > maxAdvance) {
      return res
        .status(400)
        .json({ success: false, message: "Too far in advance" });
    }

    // проверка пересечений
    const conflict = await Appointment.findOne({
      doctorId,
      status: { $in: ["pending", "confirmed"] },
      $or: [{ startsAt: { $lt: ends }, endsAt: { $gt: starts } }],
    }).session(session);

    if (conflict) {
      return res
        .status(409)
        .json({ success: false, message: "Slot already taken" });
    }

    const price = schedule.priceAZN || 0;
    const needPay = price > 0;

    const appt = await Appointment.create(
      [
        {
          doctorId,
          patientId,
          startsAt: starts,
          endsAt: ends,
          type,
          priceAZN: price,
          status: schedule.autoApprove
            ? needPay
              ? "pending"
              : "confirmed"
            : "pending",
          payment: {
            required: needPay,
            method: needPay ? "local" : "none",
            currency: "AZN",
            amount: price,
            status: needPay ? "requires_payment" : "not_needed",
          },
          notesPatient,
          createdBy: req.userId,
          uniqueKey: uniqueKey(doctorId, starts, ends),
        },
      ],
      { session },
    );

    await AppointmentAudit.create(
      [
        {
          appointmentId: appt[0]._id,
          action: "create",
          byUserId: req.userId,
        },
      ],
      { session },
    );

    await session.commitTransaction();
    session.endSession();

    // Дальше: если needPay — верните клиенту redirect/intent для оплаты
    res.json({ success: true, appointment: appt[0], paymentRequired: needPay });
  } catch (e) {
    await session.abortTransaction();
    session.endSession();
    if (e.code === 11000) {
      return res
        .status(409)
        .json({ success: false, message: "Slot already taken (race)" });
    }
    console.error(e);
    res.status(500).json({ success: false, message: "Server error" });
  }
};
