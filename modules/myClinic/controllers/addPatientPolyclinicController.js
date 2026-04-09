// ==========================================
//  addPatientPolyclinicController.js
//  ВРАЧ ПРИВЯЗЫВАЕТ СУЩЕСТВУЮЩЕГО ПАЦИЕНТА
// ==========================================

import mongoose from "mongoose";
import User from "../../../common/models/Auth/users.js";
import PatientProfile from "../../../common/models/PatientProfile/patientProfile.js";
import DoctorProfile from "../../../common/models/DoctorProfile/profileDoctor.js";
import NewPatientPolyclinic from "../../../common/models/Polyclinic/newPatientPolyclinic.js";
import crypto from "crypto";

// ------------------------------------------
// 🔐 Хеш email
// ------------------------------------------
const sha256Lower = (v) =>
  crypto
    .createHash("sha256")
    .update(
      String(v || "")
        .trim()
        .toLowerCase(),
    )
    .digest("hex");

// ------------------------------------------
// 🎯 Controller
// ------------------------------------------
const addPatientPolyclinicController = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const doctorId = req.user?.userId;

    if (!doctorId) {
      await session.abortTransaction();
      session.endSession();
      return res.status(403).json({
        message: "Doctor not authorized",
      });
    }

    const { email } = req.body;

    if (!email) {
      await session.abortTransaction();
      session.endSession();
      return res.status(400).json({
        message: "Patient email is required",
      });
    }

    const emailHash = sha256Lower(email);

    // 🔎 Ищем пациента
    const existingUser = await User.findOne({
      emailHash,
      isPatient: true,
      isDeleted: { $ne: true },
    }).session(session);

    if (!existingUser) {
      await session.abortTransaction();
      session.endSession();
      return res.status(404).json({
        message:
          "Patient not found in system. Patient must register in Docpats.",
        status: "notFound",
      });
    }

    // ============================================
    // 🛑 Проверка уже привязан?
    // ============================================

    const alreadyLinked = await User.exists({
      _id: existingUser._id,
      myDoctors: doctorId,
    }).session(session);

    if (alreadyLinked) {
      await session.commitTransaction();
      session.endSession();

      return res.status(200).json({
        message: "Patient already linked to this doctor.",
        status: "alreadyAttached",
      });
    }

    // ============================================
    // 💎 ПРИВЯЗКА (атомарно)
    // ============================================

    // 1️⃣ User
    await User.updateOne(
      { _id: existingUser._id },
      { $addToSet: { myDoctors: doctorId } },
      { session },
    );

    // 2️⃣ PatientProfile (по userId — правильнее)
    await PatientProfile.updateOne(
      { userId: existingUser._id },
      { $addToSet: { doctorId: doctorId } },
      { session },
    );

    // 3️⃣ DoctorProfile
    await DoctorProfile.updateOne(
      { userId: doctorId },
      { $addToSet: { patients: existingUser._id } },
      { session },
    );

    // 4️⃣ NewPatientPolyclinic если существует
    await NewPatientPolyclinic.updateOne(
      { emailHash },
      { $addToSet: { doctorId: doctorId } },
      { session },
    );

    await session.commitTransaction();
    session.endSession();

    return res.status(200).json({
      message: "Patient successfully linked to your cabinet.",
      patientId: existingUser._id,
      status: "attached",
    });
  } catch (error) {
    await session.abortTransaction();
    session.endSession();

    console.error("❌ addPatientPolyclinic error:", error);

    return res.status(500).json({
      message: "Server error while linking patient",
    });
  }
};

export default addPatientPolyclinicController;
