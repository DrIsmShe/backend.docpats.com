// server/controllers/clinic/patientDetailsController.js
import mongoose from "mongoose";
import dotenv from "dotenv";
import NewPatientPolyclinic from "../../../common/models/Polyclinic/newPatientPolyclinic.js";
import ProfilePatient from "../../../common/models/PatientProfile/patientProfile.js";

dotenv.config();

/* ======================== R2 helpers ======================== */

const R2_PUBLIC = (
  process.env.R2_PUBLIC_URL ||
  "https://pub-02fd367c4d0849cab12ceeb5bb357124.r2.dev"
).replace(/\/+$/, "");

const normalizeUploadsPath = (p) =>
  String(p || "")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/^uploads\/+/, "");

const toUploadsUrl = (p) => `${R2_PUBLIC}/uploads/${normalizeUploadsPath(p)}`;

const isPlaceholder = (p) => {
  const name = normalizeUploadsPath(p).toLowerCase();
  return (
    !name ||
    name === "default.png" ||
    name === "default.jpg" ||
    name.startsWith("default/")
  );
};

// === Пол из bio ===
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

// === Дефолт по bio ===
const pickDefaultByBio = (bio) => {
  const g = String(normalizeSexFromBio(bio)).toLowerCase();
  if (g === "woman") return "default/default-patient-woman.png";
  if (g === "man") return "default/default-patient-man.png";
  return "default/default-patient.png";
};

// === Построение фото ===
const buildPhotoUrl = (patientLike) => {
  const raw = patientLike?.photo || "";

  // Если абсолютная ссылка — возвращаем только если она ведёт на R2
  if (/^https?:\/\//i.test(raw)) {
    if (/r2\.dev|cloudflarestorage\.com/i.test(raw)) return raw;
    return toUploadsUrl(pickDefaultByBio(patientLike?.bio));
  }

  // Относительный путь → R2
  if (raw && !isPlaceholder(raw)) return toUploadsUrl(raw);

  // Дефолт по bio → тоже через R2
  return toUploadsUrl(pickDefaultByBio(patientLike?.bio));
};

/* ========================== Контроллер ========================== */

const patientDetailsController = async (req, res) => {
  try {
    const { id } = req.params;

    if (!id || !mongoose.isValidObjectId(id)) {
      return res.status(400).json({ message: "Некорректный ID пациента." });
    }

    // Загружаем карточку пациента
    const doc = await NewPatientPolyclinic.findById(id)
      .setOptions({ strictPopulate: false })
      .exec();

    if (!doc) {
      return res.status(404).json({ message: "Пациент не найден." });
    }

    const p = doc.toObject({ getters: true, virtuals: true });

    // Фото из ProfilePatient
    const profile = await ProfilePatient.findOne({
      userId: p.linkedUserId,
    }).lean();

    const finalPhoto = profile?.photo || p.photo || "";

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

    // DTO → теперь фото всегда R2
    const dto = {
      _id: p._id,
      patientId: p.patientId,
      patientUUID: p.patientUUID,

      firstName: p.firstName || "",
      lastName: p.lastName || "",
      email: p.email || "",
      phoneNumber: p.phoneNumber || "",

      identityDocument: p.identityDocument || "",
      bio,
      birthDate: p.birthDate || null,
      country: p.country || "",
      about: p.about || "",
      address: p.address || "",

      status: p.status || "Pending",
      paymentStatus: p.paymentStatus || "Pending",
      isConsentGiven: !!p.isConsentGiven,
      isVerified: !!p.isVerified,
      isActive: !!p.isActive,

      // 🔥 Всегда Cloudflare R2
      photo: buildPhotoUrl({ photo: finalPhoto, bio }),

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
