// server/modules/.../controllers/checkPatientInClinicController.js
import mongoose from "mongoose";
import NewPatientPolyclinic from "../../../common/models/Polyclinic/newPatientPolyclinic.js";

const checkPatientInClinicController = async (req, res) => {
  try {
    // Берём userId из сессии, а не из params — так безопаснее после авторизации
    const rawUserId = req.session?.userId;
    if (!rawUserId || !mongoose.Types.ObjectId.isValid(rawUserId)) {
      return res
        .status(401)
        .json({ ok: false, authenticated: false, exists: false });
    }
    const userId = new mongoose.Types.ObjectId(rawUserId);

    console.log(
      "🔍 Проверяем наличие карты в поликлинике по linkedUserId:",
      String(userId)
    );

    // ТОЛЬКО читаем — НИКАКИХ upsert/созданий здесь
    const card = await NewPatientPolyclinic.findOne({
      linkedUserId: userId,
    }).lean({ getters: true, virtuals: true });

    if (card) {
      console.log("✅ Карта пациента найдена:", card._id.toString());
      return res.json({
        ok: true,
        exists: true,
        patientPolyclinicId: card._id,
      });
    }

    console.log("⚠️ Карта пациента НЕ найдена.");
    return res.json({ ok: true, exists: false, patientPolyclinicId: null });
  } catch (error) {
    console.error("❌ Ошибка при проверке пациента в клинике:", error);
    return res
      .status(500)
      .json({ ok: false, exists: false, message: "Ошибка сервера" });
  }
};

export default checkPatientInClinicController;
