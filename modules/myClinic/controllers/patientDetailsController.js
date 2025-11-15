// server/controllers/clinic/patientDetailsController.js
import mongoose from "mongoose";
import dotenv from "dotenv";
import NewPatientPolyclinic from "../../../common/models/Polyclinic/newPatientPolyclinic.js";

dotenv.config();

/* ===== Helpers for /uploads ===== */
const UPLOADS_ORIGIN = (
  process.env.PUBLIC_UPLOADS_ORIGIN || "http://localhost:11000"
).replace(/\/+$/, "");

const toUploadsUrl = (p) =>
  `${UPLOADS_ORIGIN}/uploads/${String(p || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/^uploads\/+/, "")}`;

const isPlaceholder = (p) => {
  const name = String(p || "")
    .toLowerCase()
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/^uploads\/+/, "");
  return (
    !name ||
    name === "default.png" ||
    name === "default.jpg" ||
    name.startsWith("default/")
  );
};

// ✅ нормализуем «пол» ТОЛЬКО из bio
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

// ✅ дефолтная картинка по bio (без использования поля gender)
const pickDefaultByBio = (bio) => {
  const g = String(normalizeSexFromBio(bio)).toLowerCase();
  if (g === "woman") return "default/default-patient-woman.png";
  if (g === "man") return "default/default-patient-man.png";
  return "default/default-patient.png"; // нейтральный
};

const buildPhotoUrl = (patientLike) => {
  const raw = patientLike?.photo || "";
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw && !isPlaceholder(raw)) return toUploadsUrl(raw);
  // ✅ ориентируемся только на bio
  return toUploadsUrl(pickDefaultByBio(patientLike?.bio));
};

/* ===== Контроллер ===== */
const patientDetailsController = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id || !mongoose.isValidObjectId(id)) {
      return res.status(400).json({ message: "Некорректный ID пациента." });
    }

    // без .lean(), чтобы сработали виртуалы/геттеры
    const doc = await NewPatientPolyclinic.findById(id)
      .setOptions({ strictPopulate: false })
      .exec();

    if (!doc) {
      return res.status(404).json({ message: "Пациент не найден." });
    }

    const p = doc.toObject({ getters: true, virtuals: true });

    // нормализуем ТОЛЬКО bio
    const bio = normalizeSexFromBio(p.bio);

    const doctorList = Array.isArray(p.doctorId)
      ? p.doctorId
      : p.doctorId
      ? [p.doctorId]
      : [];
    const doctorId = doctorList
      .filter(Boolean)
      .map((d) =>
        typeof d === "object"
          ? { _id: d._id, firstName: d.firstName, lastName: d.lastName }
          : { _id: d }
      );

    const dto = {
      _id: p._id,
      patientId: p.patientId,
      patientUUID: p.patientUUID,

      firstName: p.firstName || "",
      lastName: p.lastName || "",
      email: p.email || "",
      phoneNumber: p.phoneNumber || "",

      identityDocument: p.identityDocument || "",
      bio, // ← единственное поле, отражающее пол
      birthDate: p.birthDate || null,
      country: p.country || "",
      about: p.about || "",
      address: p.address || "",

      status: p.status || "Pending",
      paymentStatus: p.paymentStatus || "Pending",
      isConsentGiven: !!p.isConsentGiven,
      isVerified: !!p.isVerified,
      isActive: !!p.isActive,

      photo: buildPhotoUrl({ photo: p.photo, bio }), // ← дефолт от bio
      qrCode: p.qrCode || null,

      doctorId,

      chronicDiseases: p.chronicDiseases || "",
      operations: p.operations || "",
      familyHistoryOfDisease: p.familyHistoryOfDisease || "",
      allergies: p.allergies || "",
      immunization: p.immunization || "",
      badHabits: p.badHabits || "",

      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    };

    return res.status(200).json(dto);
  } catch (error) {
    console.error(
      "❌ patientDetailsController error:",
      error?.name,
      error?.message
    );
    return res.status(500).json({ message: "Ошибка сервера." });
  }
};

export default patientDetailsController;
