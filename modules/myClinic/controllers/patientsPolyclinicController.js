// server/modules/clinic/controllers/getPatientsPolyclinic.js
import mongoose from "mongoose";
import dotenv from "dotenv";
import crypto from "crypto";
import NewPatientPolyclinic from "../../../common/models/Polyclinic/newPatientPolyclinic.js";
import User from "../../../common/models/Auth/users.js";

dotenv.config();

/* ========================== helpers ========================== */
const sha256Lower = (s) =>
  crypto
    .createHash("sha256")
    .update(String(s || "").toLowerCase())
    .digest("hex");

const normalizeEmail = (s) => String(s || "").trim();
const normalizePhone = (s = "") => {
  const raw = String(s || "").replace(/[^\d+]/g, "");
  const withPlus = raw.startsWith("+") ? raw : `+${raw.replace(/^(\+)?/, "")}`;
  return withPlus.replace(/\s+/g, "");
};
const esc = (s) => String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// ✅ ЕДИНСТВЕННЫЙ нормализатор пола по BIO
const normalizeSexFromBio = (v) => {
  const raw = String(v ?? "")
    .trim()
    .toLowerCase();
  if (!raw) return "";
  const man = new Set([
    "male",
    "man",
    "m",
    "erkek",
    "kişi",
    "м",
    "муж",
    "мужчина",
  ]);
  const woman = new Set([
    "female",
    "woman",
    "f",
    "kadin",
    "qadın",
    "ж",
    "жен",
    "женщина",
  ]);
  if (man.has(raw)) return "Man";
  if (woman.has(raw)) return "Woman";
  return raw.charAt(0).toUpperCase() + raw.slice(1);
};

const getPatientsPolyclinic = async (req, res) => {
  const { userId } = req.params;

  const page = Math.max(1, parseInt(req.query.page || "1", 10));
  const pageSize = Math.min(
    50,
    Math.max(1, parseInt(req.query.pageSize || "10", 10))
  );
  const skip = (page - 1) * pageSize;

  if (!userId || !mongoose.isValidObjectId(userId)) {
    return res
      .status(400)
      .json({ message: "Отсутствует или некорректный userId" });
  }

  try {
    const baseDoctor = { doctorId: new mongoose.Types.ObjectId(userId) };
    const {
      firstName,
      lastName,
      birthDate,
      identityDocument,
      email,
      patientUUID,
      phoneNumber,
      id,
    } = req.query;

    const q = { ...baseDoctor };

    if (firstName?.trim())
      q.firstName = { $regex: esc(firstName.trim()), $options: "i" };
    if (lastName?.trim())
      q.lastName = { $regex: esc(lastName.trim()), $options: "i" };

    if (birthDate) {
      const d = new Date(`${birthDate}T00:00:00.000Z`);
      if (!isNaN(d.getTime())) {
        const d2 = new Date(d);
        d2.setUTCDate(d.getUTCDate() + 1);
        q.birthDate = { $gte: d, $lt: d2 };
      }
    }

    if (identityDocument?.trim())
      q.identityDocument = {
        $regex: esc(identityDocument.trim()),
        $options: "i",
      };
    if (patientUUID?.trim()) q.patientUUID = patientUUID.trim();
    if (email?.trim()) q.emailHash = sha256Lower(normalizeEmail(email));
    if (phoneNumber?.trim()) {
      const normalized = normalizePhone(phoneNumber);
      q.phoneHash = normalized ? sha256Lower(normalized) : "__no_match__";
    }
    if (id && mongoose.isValidObjectId(id))
      q._id = new mongoose.Types.ObjectId(id);

    const allUsers = await User.find({ role: "patient" }, "_id").lean();
    const userPatientIds = new Set(allUsers.map((u) => String(u._id)));

    // ⚠️ без .lean(), чтобы сработали виртуалы/геттеры модели
    const [total, docs] = await Promise.all([
      NewPatientPolyclinic.countDocuments(q),
      NewPatientPolyclinic.find(q)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(pageSize)
        .exec(),
    ]);

    const patients = docs.map((doc) => {
      const d = doc.toObject({ getters: true, virtuals: true });

      // ✅ используем ТОЛЬКО bio
      const bio = normalizeSexFromBio(d.bio);

      return {
        _id: d._id,
        firstName: d.firstName || "",
        lastName: d.lastName || "",
        email: d.email || "",
        phoneNumber: d.phoneNumber || "",
        identityDocument: d.identityDocument ?? "",
        bio, // ← единственное «поле пола»
        birthDate: d.birthDate ?? null,
        address: d.address ?? "",
        country: d.country ?? "",
        about: d.about ?? "",
        badHabits: d.badHabits ?? "",
        immunization: d.immunization ?? "",
        allergies: d.allergies ?? "",
        familyHistoryOfDisease: d.familyHistoryOfDisease ?? "",
        operations: d.operations ?? "",
        chronicDiseases: d.chronicDiseases ?? "",
        patientUUID: d.patientUUID,
        isConsentGiven: d.isConsentGiven ?? false,
        isConfirmedByPatient:
          d.linkedUserId && userPatientIds.has(String(d.linkedUserId)),
        createdAt: d.createdAt,
      };
    });

    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    return res
      .status(200)
      .json({ patients, total, totalPages, page, pageSize });
  } catch (error) {
    console.error("❌ Ошибка при получении пациентов:", error);
    return res.status(500).json({ message: "Ошибка сервера" });
  }
};

export default getPatientsPolyclinic;
