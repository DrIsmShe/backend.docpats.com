// ==========================================
//  addPatientPolyclinicController.js
//  ВРАЧ НЕ СОЗДАЁТ ПАЦИЕНТА — ТОЛЬКО ПРИВЯЗЫВАЕТ
// ==========================================

import User from "../../../common/models/Auth/users.js";
import PatientProfile from "../../../common/models/PatientProfile/patientProfile.js";
import DoctorProfile from "../../../common/models/DoctorProfile/profileDoctor.js";
import NewPatientPolyclinic from "../../../common/models/Polyclinic/newPatientPolyclinic.js";
import crypto from "crypto";

// Хеш email / телефона
const sha256Lower = (v) =>
  crypto
    .createHash("sha256")
    .update(String(v || "").toLowerCase())
    .digest("hex");

const addPatientPolyclinicController = async (req, res) => {
  try {
    const doctorId = req.user?.userId;
    if (!doctorId) {
      return res.status(403).json({ message: "Врач не авторизован." });
    }

    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ message: "Введите e-mail пациента." });
    }

    const emailHash = sha256Lower(email);

    // Ищем во всех моделях
    const [existingUser, existingPatient, existingNpc] = await Promise.all([
      User.findOne({ emailHash }),
      PatientProfile.findOne({ emailHash }),
      NewPatientPolyclinic.findOne({ emailHash }),
    ]);

    // ============================================
    // 1️⃣ Пациент уже есть в поликлинике (NPC)
    // ============================================
    if (existingNpc) {
      const hasDoctor = existingNpc.doctorId?.some(
        (d) => String(d) === String(doctorId)
      );

      if (!hasDoctor) {
        existingNpc.doctorId.push(doctorId);
        existingNpc.$locals = { allowCreate: true };
        await existingNpc.save();
      }

      // Привязать PatientProfile, если он есть
      if (existingPatient) {
        if (
          !existingPatient.doctorId?.some((d) => String(d) === String(doctorId))
        ) {
          existingPatient.doctorId.push(doctorId);
          await existingPatient.save();
        }

        await DoctorProfile.findOneAndUpdate(
          { linkedUserId: doctorId },
          { $addToSet: { patients: existingPatient._id } }
        );
      }

      return res.status(200).json({
        message: "Пациент успешно привязан к вашему кабинету.",
        patient: existingNpc,
        status: "attached",
      });
    }

    // ============================================
    // 2️⃣ Пациент есть в системе (User / PatientProfile),
    //     но НЕ открыл аккаунт в поликлинике
    // ============================================
    if (existingUser || existingPatient) {
      return res.status(409).json({
        message:
          "Пациент зарегистрирован в системе, но ещё не активировал поликлинический профиль. " +
          "Попросите пациента войти в Docpats и открыть аккаунт поликлиники.",
        status: "needsPatientActivation",
      });
    }

    // ============================================
    // 3️⃣ Пациента нет ВООБЩЕ
    // ============================================
    return res.status(404).json({
      message:
        "Пациент не найден в системе. Он должен самостоятельно зарегистрироваться в Docpats.",
      status: "notFound",
    });

    // ====== END ======
  } catch (error) {
    console.error("❌ Ошибка addPatientPolyclinic:", error);
    return res.status(500).json({
      message: "Ошибка сервера при привязке пациента.",
    });
  }
};

export default addPatientPolyclinicController;
