// server/modules/patientProfile/controllers/removeDoctorFromMyDoctorsController.js
import mongoose from "mongoose";
import User from "../../../common/models/Auth/users.js";

const toOID = (v) =>
  mongoose.isValidObjectId(v) ? new mongoose.Types.ObjectId(v) : null;
const uniq = (arr) => [...new Set(arr.map(String))];

const getPatientId = (req) =>
  req.session?.userId ||
  req.userId ||
  req.user?._id ||
  req.auth?.userId ||
  null;

export async function removeDoctorFromMyDoctors(req, res) {
  try {
    const patientId = getPatientId(req);
    const { doctorId } = req.params; // основной кандидат
    const { alt } = req.query || {}; // второй кандидат (опционально)

    if (!patientId) {
      return res
        .status(401)
        .json({ success: false, message: "Пациент не авторизован." });
    }
    if (!doctorId && !alt) {
      return res
        .status(400)
        .json({ success: false, message: "Не передан ID доктора." });
    }

    // Собираем все кандидаты (как строки и как ObjectId)
    const rawCandidates = uniq([doctorId, alt].filter(Boolean));
    const oidCandidates = rawCandidates.map(toOID).filter(Boolean);
    const pullScalars = [...rawCandidates, ...oidCandidates]; // на случай, если хранятся примитивы

    // 1) Пытаемся удалить как простые значения массива (userId/profileId)
    let result = await User.updateOne(
      { _id: patientId },
      { $pull: { myDoctors: { $in: pullScalars } } }
    );

    // 2) Если не сработало – пробуем как массив поддокументов { doctor: <id> }
    if (!result.modifiedCount) {
      result = await User.updateOne(
        { _id: patientId },
        {
          $pull: {
            myDoctors: {
              doctor: { $in: [...oidCandidates, ...rawCandidates] },
            },
          },
        }
      );
    }

    // 3) Ещё вариант — { profileId: <id> }
    if (!result.modifiedCount) {
      result = await User.updateOne(
        { _id: patientId },
        {
          $pull: {
            myDoctors: {
              profileId: { $in: [...oidCandidates, ...rawCandidates] },
            },
          },
        }
      );
    }

    if (!result.matchedCount) {
      return res
        .status(404)
        .json({ success: false, message: "Пациент не найден." });
    }
    if (!result.modifiedCount) {
      return res
        .status(400)
        .json({ success: false, message: "Доктор не найден в Моих Докторах." });
    }

    return res
      .status(200)
      .json({ success: true, message: "Доктор удалён из Моих Докторов." });
  } catch (error) {
    console.error("❌ Ошибка при удалении доктора:", error);
    return res.status(500).json({
      success: false,
      message: "Ошибка сервера при удалении доктора.",
    });
  }
}
