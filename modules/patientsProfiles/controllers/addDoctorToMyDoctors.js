import User from "../../../common/models/Auth/users.js";
import DoctorProfile from "../../../common/models/DoctorProfile/profileDoctor.js";
// ✅ Добавление доктора в "Мои Доктора"
export const addDoctorToMyDoctors = async (req, res) => {
  try {
    const profileId = req.params.id;
    const patientId = req.session.userId;

    console.log("🔍 Попытка добавить доктора через profileId:", profileId);

    const profile = await DoctorProfile.findById(profileId).lean();

    if (!profile) {
      return res
        .status(404)
        .json({ success: false, message: "Профиль доктора не найден." });
    }

    const doctorId = profile.userId; // Берём userId через профиль
    const patient = await User.findById(patientId);
    const doctor = await User.findById(doctorId);

    if (!patient || !doctor || doctor.role !== "doctor") {
      return res
        .status(404)
        .json({ success: false, message: "Пациент или доктор не найден." });
    }

    if (!Array.isArray(patient.myDoctors)) {
      patient.myDoctors = [];
    }

    if (patient.myDoctors.includes(doctor._id)) {
      return res
        .status(400)
        .json({ success: false, message: "Доктор уже добавлен." });
    }

    patient.myDoctors.push(doctor._id);
    await patient.save();

    return res.status(200).json({
      success: true,
      message: "Доктор успешно добавлен в Мои Доктора.",
    });
  } catch (error) {
    console.error("❌ Ошибка при добавлении доктора:", error);
    return res.status(500).json({
      success: false,
      message: "Ошибка сервера при добавлении доктора.",
    });
  }
};

// ✅ Проверка, добавлен ли доктор в "Мои Доктора"
// ✅ Проверка, добавлен ли доктор в "Мои Доктора"
export const checkIfDoctorInMyDoctors = async (req, res) => {
  try {
    const { doctorId } = req.params; // может быть userId ИЛИ profileId
    const patientId = req.session.userId;

    if (!patientId) {
      return res
        .status(401)
        .json({ success: false, message: "Пациент не авторизован." });
    }

    // 1) пробуем как userId
    let targetUserId = doctorId;

    // 2) если это profileId, вытаскиваем userId
    if (!/^[0-9a-fA-F]{24}$/.test(String(doctorId))) {
      return res
        .status(400)
        .json({ success: false, message: "Некорректный ID." });
    }

    // пробуем найти профиль по этому id
    const maybeProfile = await DoctorProfile.findById(doctorId).lean();
    if (maybeProfile?.userId) {
      targetUserId = String(maybeProfile.userId);
    }

    const patient = await User.findById(patientId).select("myDoctors").lean();
    if (!patient) {
      return res
        .status(404)
        .json({ success: false, message: "Пациент не найден." });
    }

    const isAdded = Array.isArray(patient.myDoctors)
      ? patient.myDoctors.some(
          (docId) => String(docId) === String(targetUserId)
        )
      : false;

    return res.status(200).json({ success: true, isAdded });
  } catch (error) {
    console.error(
      "❌ Ошибка при проверке доктора в списке Мои Доктора:",
      error
    );
    return res
      .status(500)
      .json({ success: false, message: "Ошибка сервера при проверке." });
  }
};
