import User from "../models/Auth/users.js";

export default async function requireDoctorPatientLimit(req, res, next) {
  try {
    const user = req.user;

    // 🔐 Только для врачей
    if (!user || user.role !== "doctor") {
      return next();
    }

    const maxPatients = user.features?.maxPatients;

    // 🟢 Нет лимита (Infinity / undefined) — пропускаем
    if (maxPatients == null || maxPatients === Infinity) {
      return next();
    }

    // 🧮 Считаем пациентов врача
    const currentPatientsCount = await User.countDocuments({
      myDoctors: user._id,
      isPatient: true,
      isDeleted: { $ne: true },
    });

    if (currentPatientsCount >= maxPatients) {
      return res.status(403).json({
        message:
          "Patient limit reached. Upgrade your plan to add more patients.",
        code: "PATIENT_LIMIT_REACHED",
        limit: maxPatients,
        current: currentPatientsCount,
      });
    }

    next();
  } catch (error) {
    console.error("❌ Patient limit middleware error:", error);
    return res.status(500).json({
      message: "Unable to check patient limit",
    });
  }
}
