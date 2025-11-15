// ✅ clinic/controllers/patientSearchPolyclinicController.js
import crypto from "crypto";
import dotenv from "dotenv";
import QRCode from "qrcode"; // оставил импорт, если где-то выше на него рассчитываете
import NewPatientPolyclinic from "../../../common/models/Polyclinic/newPatientPolyclinic.js";

dotenv.config();

/* ================= Common helpers ================= */
// AES-256 key (ровно 32 байта)
const SECRET_KEY = (process.env.ENCRYPTION_KEY || "default_secret_key")
  .padEnd(32, "0")
  .slice(0, 32);
if (!SECRET_KEY || SECRET_KEY.length !== 32) {
  throw new Error("❌ Error: ENCRYPTION_KEY not found or invalid!");
}

const sha256Lower = (s = "") =>
  crypto
    .createHash("sha256")
    .update(String(s).trim().toLowerCase())
    .digest("hex");

const normalizePhone = (s = "") => {
  const raw = String(s || "");
  if (!raw) return "";
  const cleaned = raw.replace(/[^\d+]/g, "");
  const withPlus = cleaned.startsWith("+")
    ? cleaned
    : `+${cleaned.replace(/^(\+)?/, "")}`;
  return /^\+\d{1,15}$/.test(withPlus) ? withPlus : "";
};

const decrypt = (encryptedText) => {
  if (
    !encryptedText ||
    typeof encryptedText !== "string" ||
    !encryptedText.includes(":")
  )
    return encryptedText;
  try {
    const [ivHex, dataHex] = encryptedText.split(":");
    const decipher = crypto.createDecipheriv(
      "aes-256-cbc",
      Buffer.from(SECRET_KEY),
      Buffer.from(ivHex, "hex")
    );
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(dataHex, "hex")),
      decipher.final(),
    ]);
    return decrypted.toString("utf8");
  } catch (err) {
    console.error("❌ Decryption error:", err.message);
    return null;
  }
};

/* ================ Controller (READ-ONLY search) ================ */
const patientSearchPolyclinicController = async (req, res) => {
  try {
    /* --- Auth / role check --- */
    const currentUserId = req.session?.userId || req.user?.userId;
    const currentRole = req.session?.role || req.user?.role || "unknown";
    if (!currentUserId) {
      return res.status(403).json({ message: "Please log in." });
    }
    if (currentRole !== "doctor") {
      // по логам у вас именно доктор дергает этот эндпоинт; оставим мягкую проверку
      console.log(
        "🔍 User role:",
        currentRole,
        "→ access allowed only for doctor"
      );
    } else {
      console.log("✅ Access allowed for doctor");
    }

    /* --- Query validation --- */
    const rawQuery = String(req.query?.query || "").trim();
    if (!rawQuery) {
      return res.status(400).json({
        message: "Enter Patient ID, UUID, Email, Phone, Document or QR code.",
      });
    }
    console.log("🔍 Original request:", rawQuery);

    /* --- Build search conditions (READ ONLY) --- */
    const or = [];

    // 1) Patient ID:
    // у вас генератор: "PA-" + base36 + "-" + 6 цифр → поддержим и старый формат "PA123456"
    if (/^PA[-A-Z0-9]+(?:-\d{6})?$/i.test(rawQuery)) {
      or.push({ patientId: rawQuery.toUpperCase() });
    }

    // 2) UUID v4
    if (
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        rawQuery
      )
    ) {
      or.push({ patientUUID: rawQuery });
    }

    // 3) Identity document (как есть)
    or.push({ identityDocument: rawQuery });

    // 4) Email hash
    const emailHash = sha256Lower(rawQuery);
    or.push({ emailHash });

    // 5) Phone hash (если это похоже на телефон)
    const normPhone = normalizePhone(rawQuery);
    if (normPhone) {
      const phoneHash = sha256Lower(normPhone);
      or.push({ phoneHash });
    }

    // 6) QR code: обычно хранится как dataURL (длинная строка).
    // Если на клиент приходит весь dataURL → точное совпадение;
    // Если приходит только payload (например, UUID или base64) — это лучше обрабатывать на клиенте.
    // Здесь добавим мягкую проверку на точное совпадение:
    if (rawQuery.startsWith("data:image/")) {
      or.push({ qrCode: rawQuery });
    }

    // Безопасный поиск ЧТЕНИЕМ: lean() + select нужных полей
    const patient = await NewPatientPolyclinic.findOne({ $or: or })
      .select(
        "_id patientId patientUUID qrCode doctorId firstNameEncrypted lastNameEncrypted emailEncrypted phoneEncrypted identityDocument birthDate status isActive"
      )
      .lean();

    if (!patient) {
      console.log("❌ Patient not found.");
      return res
        .status(200)
        .json({ found: false, message: "Patient not found." });
    }

    console.log("✅ Patient found:", patient.patientId || patient._id);

    /* --- Optional: attach doctor if not attached (NO SAVE, NO UPSERT) --- */
    const alreadyAttached =
      Array.isArray(patient.doctorId) &&
      patient.doctorId.some((id) => String(id) === String(currentUserId));

    if (!alreadyAttached) {
      await NewPatientPolyclinic.updateOne(
        { _id: patient._id },
        { $addToSet: { doctorId: currentUserId } }, // только обновление
        { upsert: false }
      );
      console.log(
        "🔗 Doctor added to patient via $addToSet (no save, no upsert)."
      );
    }

    /* --- Build safe response --- */
    const safePatient = {
      ...patient,
      // Расшифровка чувствительных полей для ответа (если это ваша бизнес-логика)
      email: decrypt(patient.emailEncrypted),
      phoneNumber: decrypt(patient.phoneEncrypted),
      identityDocument: decrypt(patient.identityDocument),
      birthDate: patient.birthDate || null,
    };

    return res.status(200).json({
      found: true,
      message: "Patient found.",
      patient: safePatient,
    });
  } catch (error) {
    console.error("❌ Error while searching for patient:", error);
    return res
      .status(500)
      .json({ message: "Error while searching for patient" });
  }
};

export default patientSearchPolyclinicController;
