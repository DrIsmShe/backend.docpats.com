// server/modules/clinic/controllers/getPatientsPolyclinic.js
import mongoose from "mongoose";
import crypto from "crypto";
import NewPatientPolyclinic from "../../../common/models/Polyclinic/newPatientPolyclinic.js";
import DoctorPrivatePatient from "../../../common/models/Polyclinic/DoctorPrivatePatient.js";
import User from "../../../common/models/Auth/users.js";

/* ========================== crypto helpers ========================== */
// ДОЛЖНО совпадать с тем, как ты шифруешь в моделях User / NewPatientPolyclinic
const RAW_KEY = process.env.ENCRYPTION_KEY || "default_secret_key";
const SECRET_KEY = RAW_KEY.padEnd(32, "0").slice(0, 32);

const isIvCipher = (s) =>
  typeof s === "string" && /^[0-9a-fA-F]{32}:[0-9a-fA-F]+$/.test(s);

const decrypt = (cipherText) => {
  if (!isIvCipher(cipherText)) return cipherText || "";
  try {
    const [ivHex, dataHex] = cipherText.split(":");
    const decipher = crypto.createDecipheriv(
      "aes-256-cbc",
      Buffer.from(SECRET_KEY),
      Buffer.from(ivHex, "hex"),
    );
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(dataHex, "hex")),
      decipher.final(),
    ]);
    return decrypted.toString("utf8");
  } catch {
    return "";
  }
};

/* ========================== helpers ========================== */
const sha256Lower = (s) =>
  crypto
    .createHash("sha256")
    .update(String(s || "").toLowerCase())
    .digest("hex");

const normalizeEmail = (s) =>
  String(s || "")
    .trim()
    .toLowerCase();

const normalizePhone = (s = "") =>
  String(s || "")
    .replace(/[^\d+]/g, "")
    .replace(/\s+/g, "");

const esc = (s) => String(s || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const normalizeSexFromBio = (v) => {
  const raw = String(v ?? "")
    .trim()
    .toLowerCase();
  if (!raw) return "";
  if (["male", "man", "m", "erkek", "kişi", "м", "муж"].includes(raw))
    return "Man";
  if (["female", "woman", "f", "qadın", "kadin", "ж", "жен"].includes(raw))
    return "Woman";
  return raw.charAt(0).toUpperCase() + raw.slice(1);
};

const getPatientsPolyclinic = async (req, res) => {
  const { userId } = req.params;

  if (!mongoose.isValidObjectId(userId)) {
    return res.status(400).json({ message: "Invalid userId" });
  }

  const page = Math.max(1, parseInt(req.query.page || "1", 10));
  const pageSize = Math.min(
    50,
    Math.max(1, parseInt(req.query.pageSize || "10", 10)),
  );

  const doctorUserObjectId = new mongoose.Types.ObjectId(userId);

  try {
    const {
      firstName,
      lastName,
      birthDate,
      identityDocument,
      email,
      phoneNumber,
      id,
      patientType, // "private" | "registered" | ""
    } = req.query;

    /* ===================== 1. БАЗОВЫЕ ЗАПРОСЫ ===================== */

    // Пациенты клиники (NewPatientPolyclinic)
    const clinicQuery = {
      doctorId: { $in: [doctorUserObjectId] },
      isDeleted: { $ne: true },
    };

    // Приватные пациенты (DoctorPrivatePatient)
    const privateQuery = {
      doctorUserId: doctorUserObjectId,
      isArchived: { $ne: true },
    };

    /* ===================== 2. ФИЛЬТРЫ (общие) ===================== */

    if (firstName?.trim()) {
      const hash = sha256Lower(firstName.trim());
      clinicQuery.firstNameHash = hash;
      privateQuery.firstNameHash = hash;
    }

    if (lastName?.trim()) {
      const hash = sha256Lower(lastName.trim());
      clinicQuery.lastNameHash = hash;
      privateQuery.lastNameHash = hash;
    }

    if (birthDate) {
      const d = new Date(`${birthDate}T00:00:00.000Z`);
      if (!isNaN(d.getTime())) {
        const d2 = new Date(d);
        d2.setUTCDate(d.getUTCDate() + 1);
        clinicQuery.birthDate = { $gte: d, $lt: d2 };
        privateQuery.dateOfBirth = { $gte: d, $lt: d2 };
      }
    }

    if (identityDocument?.trim()) {
      clinicQuery.identityDocument = {
        $regex: esc(identityDocument.trim()),
        $options: "i",
      };
      // В DoctorPrivatePatient нет identityDocument, поэтому туда не добавляем
    }

    if (email?.trim()) {
      const hash = sha256Lower(normalizeEmail(email));
      clinicQuery.emailHash = hash;
      privateQuery.emailHash = hash;
    }

    if (phoneNumber?.trim()) {
      const normalized = normalizePhone(phoneNumber);
      if (normalized) {
        const hash = sha256Lower(normalized);
        clinicQuery.phoneHash = hash;
        privateQuery.phoneHash = hash;
      }
    }

    if (id && mongoose.isValidObjectId(id)) {
      const oid = new mongoose.Types.ObjectId(id);
      clinicQuery._id = oid;
      privateQuery._id = oid;
    }

    /* ===================== 3. patientType (логика) ===================== */

    let useClinic = true;
    let usePrivate = true;

    if (patientType === "registered") {
      // Только зарегистрированные (клиника, привязанные к User)
      usePrivate = false;
      clinicQuery.linkedUserId = { $ne: null };
    } else if (patientType === "private") {
      // Только приватные
      // если увидишь дубли — можно сделать useClinic = false
      clinicQuery.migrationStatus = "private";
    }
    // Если patientType пустой -> берём и клинику, и приват

    /* ===================== 4. Список userId пациентов (для телефонов и isConfirmedByPatient) ===================== */

    const patientUsers = await User.find(
      { role: "patient" },
      "_id phoneEncrypted",
    ).lean();

    const patientUserMap = new Map(patientUsers.map((u) => [String(u._id), u]));
    const patientUserIds = new Set(patientUsers.map((u) => String(u._id)));

    /* ===================== 5. ВЫБОРКИ ИЗ ОБЕИХ ТАБЛИЦ ===================== */

    const clinicPromise = useClinic
      ? NewPatientPolyclinic.find(clinicQuery).sort({ createdAt: -1 }).exec()
      : Promise.resolve([]);

    const privatePromise = usePrivate
      ? DoctorPrivatePatient.find(privateQuery).sort({ createdAt: -1 }).exec()
      : Promise.resolve([]);

    const [clinicDocsRaw, privateDocsRaw] = await Promise.all([
      clinicPromise,
      privatePromise,
    ]);

    // Приводим к plain-объектам с виртуалами
    const clinicDocs = clinicDocsRaw.map((doc) =>
      doc.toObject({ virtuals: true, getters: true }),
    );
    const privateDocs = privateDocsRaw.map((doc) =>
      doc.toObject({ virtuals: true, getters: true }),
    );

    /* ===================== 6. МАППИНГ В ЕДИНЫЙ DTO ===================== */

    const clinicPatients = clinicDocs.map((d) => {
      const user = d.linkedUserId
        ? patientUserMap.get(String(d.linkedUserId))
        : null;

      const phoneFromUser = user?.phoneEncrypted
        ? decrypt(user.phoneEncrypted)
        : "";

      const isRegistered = !!user;

      return {
        _id: d._id,
        firstName: d.firstName || "",
        lastName: d.lastName || "",
        fullName:
          d.fullName || `${d.firstName || ""} ${d.lastName || ""}`.trim(),
        email: d.email || "",
        phoneNumber: phoneFromUser || d.phoneNumber || "",
        birthDate: d.birthDate ?? null,
        identityDocument: d.identityDocument ?? "",
        bio: normalizeSexFromBio(d.bio),
        country: d.country ?? "",
        patientUUID: d.patientUUID || "",
        migrationStatus:
          d.migrationStatus || (isRegistered ? "migrated" : "private"),
        patientType: isRegistered ? "registered" : "private",
        isConfirmedByPatient: isRegistered,
        createdAt: d.createdAt,
      };
    });

    const privatePatients = privateDocs.map((d) => {
      const isLinked =
        d.linkedUserId && patientUserIds.has(String(d.linkedUserId));

      return {
        _id: d._id,
        firstName: d.firstName || "",
        lastName: d.lastName || "",
        fullName:
          d.fullName || `${d.firstName || ""} ${d.lastName || ""}`.trim(),
        email: d.email || "",
        phoneNumber: d.phoneNumber || "",
        birthDate: d.dateOfBirth ?? null,
        identityDocument: "", // в этой модели нет паспорта
        bio: normalizeSexFromBio(d.gender),
        country: d.address?.country || "",
        patientUUID: "",
        migrationStatus: d.migrationStatus || "private",
        patientType: "private",
        isConfirmedByPatient: !!isLinked,
        createdAt: d.createdAt,
      };
    });

    let allPatients = [...clinicPatients, ...privatePatients];

    /* ===================== 7. СОРТИРОВКА + ПАГИНАЦИЯ В ПАМЯТИ ===================== */

    // Общая сортировка по createdAt (новые сверху)
    allPatients.sort((a, b) => {
      const at = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bt = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bt - at;
    });

    const total = allPatients.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const start = (page - 1) * pageSize;
    const end = start + pageSize;
    const pagePatients = allPatients.slice(start, end);

    return res.status(200).json({
      patients: pagePatients,
      total,
      page,
      pageSize,
      totalPages,
    });
  } catch (error) {
    console.error("❌ getPatientsPolyclinic error:", error);
    return res.status(500).json({ message: "Server error" });
  }
};

export default getPatientsPolyclinic;
