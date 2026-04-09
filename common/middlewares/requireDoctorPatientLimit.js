import mongoose from "mongoose";
import User from "../models/Auth/users.js";
import DoctorPrivatePatient from "../models/Polyclinic/DoctorPrivatePatient.js";
import DoctorProfile from "../models/DoctorProfile/profileDoctor.js";
import NewPatientPolyclinic from "../models/Polyclinic/newPatientPolyclinic.js";

export default async function requireDoctorPatientLimit(req, res, next) {
  try {
    if (!req.user || req.user.role !== "doctor") {
      return next();
    }

    const doctorUserId = new mongoose.Types.ObjectId(req.user.userId);

    // ========================
    // 1️⃣ Проверяем верификацию врача
    // ========================

    const doctorProfile = await DoctorProfile.findOne({
      userId: doctorUserId,
    })
      .select("verificationStatus")
      .lean();

    if (!doctorProfile) return next();

    const isVerified = doctorProfile.verificationStatus === "approved";

    // ========================
    // 2️⃣ Собираем УНИКАЛЬНЫХ пациентов
    // ========================

    const [registeredUsers, privatePatients, polyclinicPatients] =
      await Promise.all([
        User.find({
          myDoctors: { $in: [doctorUserId] },
          role: "patient",
          isDeleted: { $ne: true },
        })
          .select("_id")
          .lean(),

        DoctorPrivatePatient.find({
          doctorUserId,
          isDeleted: { $ne: true },
          isArchived: { $ne: true },
        })
          .select("_id")
          .lean(),

        NewPatientPolyclinic.find({
          doctorId: { $in: [doctorUserId] },
          isDeleted: { $ne: true },
          isArchived: { $ne: true },
        })
          .select("linkedUserId privatePatient")
          .lean(),
      ]);

    // создаём Set уникальных пациентов
    const uniquePatients = new Set();

    // зарегистрированные напрямую
    registeredUsers.forEach((u) =>
      uniquePatients.add(`user_${u._id.toString()}`),
    );

    // приватные
    privatePatients.forEach((p) =>
      uniquePatients.add(`private_${p._id.toString()}`),
    );

    // polyclinic (могут ссылаться либо на user, либо на private)
    polyclinicPatients.forEach((p) => {
      if (p.linkedUserId) {
        uniquePatients.add(`user_${p.linkedUserId.toString()}`);
      } else if (p.privatePatient) {
        uniquePatients.add(`private_${p.privatePatient.toString()}`);
      }
    });

    const totalPatients = uniquePatients.size;

    console.log("TOTAL UNIQUE PATIENTS:", totalPatients);

    // ========================
    // 3️⃣ Лимит для НЕ верифицированных
    // ========================

    if (!isVerified) {
      const limit = 5;

      if (totalPatients >= limit) {
        return res.status(403).json({
          success: false,
          code: "VERIFICATION_REQUIRED",
          message: "Please verify your doctor account to add more patients.",
          limit,
          current: totalPatients,
        });
      }

      return next();
    }

    // ========================
    // 4️⃣ Лимит по подписке
    // ========================

    const doctor = await User.findById(doctorUserId)
      .select("features.maxPatients")
      .lean();

    const maxPatients = doctor?.features?.maxPatients ?? 5;

    if (maxPatients === -1) return next();

    if (totalPatients >= maxPatients) {
      return res.status(403).json({
        success: false,
        code: "PLAN_LIMIT_REACHED",
        message:
          "You have reached your plan limit. Please upgrade your subscription.",
        limit: maxPatients,
        current: totalPatients,
      });
    }

    next();
  } catch (error) {
    console.error("❌ requireDoctorPatientLimit error:", error);
    return res.status(500).json({
      message: "Unable to check patient limit",
    });
  }
}
