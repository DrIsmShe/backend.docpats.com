import mongoose from "mongoose";
import NewPatientPolyclinic from "../../../common/models/Polyclinic/newPatientPolyclinic.js";
import User from "../../../common/models/Auth/users.js";

const checkPatientInClinicController = async (req, res) => {
  try {
    const rawUserId = req.session?.userId;

    if (!rawUserId || !mongoose.Types.ObjectId.isValid(rawUserId)) {
      return res.json({ ok: true, exists: false, patientPolyclinicId: null });
    }

    const userId = new mongoose.Types.ObjectId(rawUserId);

    // Загружаем пользователя, чтобы взять его телефон
    const user = await User.findById(userId).lean();
    const userPhone = user?.phoneNumber?.replace(/\D/g, "");

    let card = null;

    // 1️⃣ Ищем карту по linkedUserId
    card = await NewPatientPolyclinic.findOne({
      linkedUserId: userId,
    }).lean();

    // 2️⃣ Если не нашли — ищем по телефону (врач создал заранее)
    if (!card && userPhone) {
      card = await NewPatientPolyclinic.findOne({
        phoneNumber: { $regex: userPhone + "$" }, // поиск по последним цифрам
      }).lean();
    }

    if (!card) {
      return res.json({ ok: true, exists: false, patientPolyclinicId: null });
    }

    return res.json({
      ok: true,
      exists: true,
      patientPolyclinicId: card._id,
    });
  } catch (e) {
    console.error("checkPatientInClinic error:", e);
    return res.json({ ok: false, exists: false });
  }
};

export default checkPatientInClinicController;
