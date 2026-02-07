// server/modules/patientProfile/controllers/getMyDoctorsController.js
import mongoose from "mongoose";
import DoctorProfile from "../../../common/models/DoctorProfile/profileDoctor.js";
import User, { decrypt } from "../../../common/models/Auth/users.js";

const toOID = (v) =>
  mongoose.isValidObjectId(v) ? new mongoose.Types.ObjectId(v) : null;

const getCurrentPatientId = (req) =>
  req.session?.userId || req.userId || req.user?._id || null;

const normalizeDoctorIdsFromMyDoctors = async (myDoctors = []) => {
  const userIds = new Set();
  const profileIds = new Set();

  for (const it of myDoctors) {
    // Вариант 1: примитив (ObjectId или string userId)
    if (typeof it === "string" || mongoose.isValidObjectId(it)) {
      const oid = toOID(it) || it; // может быть строкой
      userIds.add(String(oid));
      continue;
    }

    // Вариант 2: поддокумент
    if (it && typeof it === "object") {
      // Возможные поля
      if (it.doctor) userIds.add(String(it.doctor));
      if (it.userId) userIds.add(String(it.userId));
      if (it.profileId) profileIds.add(String(it.profileId));
    }
  }

  return { userIds: Array.from(userIds), profileIds: Array.from(profileIds) };
};

const getMyDoctors = async (req, res) => {
  try {
    const patientId = getCurrentPatientId(req);
    if (!patientId) {
      return res.status(401).json({ message: "Пользователь не авторизован." });
    }

    // Берём только массив myDoctors у пользователя
    const patient = await User.findById(patientId).select("myDoctors").lean();

    if (!patient) {
      return res.status(404).json({ message: "Пациент не найден." });
    }

    if (!Array.isArray(patient.myDoctors) || patient.myDoctors.length === 0) {
      return res.status(200).json([]); // пустой список
    }

    // Соберём кандидатов userId и profileId из разных вариантов хранения
    const { userIds, profileIds } = await normalizeDoctorIdsFromMyDoctors(
      patient.myDoctors
    );

    // Если часть записей хранится по profileId — найдём их userId
    let extraUserIds = [];
    if (profileIds.length) {
      const profiles = await DoctorProfile.find({
        _id: { $in: profileIds.map((id) => toOID(id) || id) },
      })
        .select("_id userId")
        .lean();

      extraUserIds = profiles
        .map((p) => (p?.userId ? String(p.userId) : null))
        .filter(Boolean);
    }

    const uniqueUserIds = Array.from(
      new Set([...userIds, ...extraUserIds])
    ).map((id) => toOID(id) || id);

    if (!uniqueUserIds.length) {
      return res.status(200).json([]);
    }

    // Вытащим докторов по userId
    const doctors = await User.find({
      _id: { $in: uniqueUserIds },
      role: "doctor",
    })
      .populate({ path: "specialization", select: "name" })
      .lean();

    if (!doctors.length) {
      return res.status(200).json([]);
    }

    // Подтянем их профили разом
    const profiles = await DoctorProfile.find({
      userId: { $in: doctors.map((d) => d._id) },
    })
      .select("_id userId profileImage")
      .lean();

    const profileByUser = new Map(profiles.map((p) => [String(p.userId), p]));

    // Сформируем ответ
    const result = doctors.map((doc) => {
      const profile = profileByUser.get(String(doc._id));
      const firstName =
        decrypt?.(doc.firstNameEncrypted) ||
        doc.firstName ||
        doc.firstNameDecrypted ||
        "Имя не указано";
      const lastName =
        decrypt?.(doc.lastNameEncrypted) ||
        doc.lastName ||
        doc.lastNameDecrypted ||
        "Фамилия не указана";

      return {
        userId: String(doc._id),
        profileId: profile ? String(profile._id) : null,
        firstName,
        lastName,
        profileImage:
          profile?.profileImage || "http://localhost:11000/uploads/default.png",
        specialization: doc.specialization?.name || "Не указано",
      };
    });

    return res.status(200).json(result);
  } catch (error) {
    console.error("❌ Ошибка при получении списка моих докторов:", error);
    return res.status(500).json({ message: "Внутренняя ошибка сервера." });
  }
};

export default getMyDoctors;
