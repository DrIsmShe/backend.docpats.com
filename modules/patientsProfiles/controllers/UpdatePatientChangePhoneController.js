// server/modules/myClinic/controllers/UpdatePatientChangePhoneController.js
import mongoose from "mongoose";
import crypto from "crypto";
import NewPatientPolyclinic from "../../../common/models/Polyclinic/newPatientPolyclinic.js";

/* ===== crypto & helpers (совместимы с моделью NPC) ===== */
const RAW_KEY = process.env.ENCRYPTION_KEY || "default_secret_key";
const SECRET_KEY = RAW_KEY.padEnd(32, "0").slice(0, 32);

const isIvCipher = (s) =>
  typeof s === "string" && /^[0-9a-fA-F]{32}:[0-9a-fA-F]+$/.test(s);

const encrypt = (text) => {
  if (text == null) return undefined;
  const s = String(text);
  if (!s) return undefined;
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(
    "aes-256-cbc",
    Buffer.from(SECRET_KEY),
    iv
  );
  const encrypted = Buffer.concat([cipher.update(s, "utf8"), cipher.final()]);
  return `${iv.toString("hex")}:${encrypted.toString("hex")}`;
};

const decrypt = (cipherText) => {
  if (!isIvCipher(cipherText)) return cipherText || undefined;
  try {
    const [ivHex, dataHex] = cipherText.split(":");
    const iv = Buffer.from(ivHex, "hex");
    const data = Buffer.from(dataHex, "hex");
    const decipher = crypto.createDecipheriv(
      "aes-256-cbc",
      Buffer.from(SECRET_KEY),
      iv
    );
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
    return decrypted.toString("utf8");
  } catch {
    return undefined;
  }
};

const normalizePhone = (s = "") => {
  const raw = String(s || "");
  if (!raw) return "";
  const cleaned = raw.replace(/[^\d+]/g, "");
  const withPlus = cleaned.startsWith("+")
    ? cleaned
    : `+${cleaned.replace(/^(\+)?/, "")}`;
  return /^\+\d{1,15}$/.test(withPlus) ? withPlus : "";
};

const sha256Lower = (s) =>
  crypto
    .createHash("sha256")
    .update(String(s || "").toLowerCase())
    .digest("hex");

/* ===== get userId from various auth plugs ===== */
const getUserId = (req) =>
  req.userId ||
  req.user?._id ||
  req.session?.userId ||
  req.auth?.userId ||
  null;

/* ===== Controller ===== */
export async function updatePatientChangePhoneController(req, res) {
  try {
    const rawUserId = getUserId(req);
    if (!rawUserId || !mongoose.Types.ObjectId.isValid(rawUserId)) {
      return res.status(401).json({ ok: false, error: "UNAUTHORIZED" });
    }
    const userId = new mongoose.Types.ObjectId(rawUserId);

    const incomingRaw = String(req.body?.phoneNumber ?? "").trim();
    const col = NewPatientPolyclinic.collection;

    // найдём карту сырым способом (без геттеров)
    const card = await col.findOne(
      { linkedUserId: userId },
      { projection: { _id: 1, patientId: 1, phoneEncrypted: 1, phoneHash: 1 } }
    );
    if (!card) {
      return res.status(404).json({
        ok: false,
        error: "CLINIC_CARD_NOT_FOUND",
        message:
          "У вас ещё нет карты пациента в клинике. Пожалуйста, зарегистрируйтесь в клинике.",
      });
    }

    const currentCipher = card.phoneEncrypted ?? null;
    const currentPlain = decrypt(currentCipher) ?? null; // плейн из шифра
    const currentHash = card.phoneHash ?? null;

    // ===== запрос на очистку =====
    if (incomingRaw === "") {
      if (!currentCipher && !currentHash) {
        return res.json({
          ok: true,
          note: "Телефон уже пуст — изменений нет.",
          phonePlain: null,
          phoneEncrypted: null,
          phoneHash: null,
        });
      }

      // двухфазно, чтобы не мешали хуки/сеттеры
      await col.updateOne(
        { _id: card._id },
        { $unset: { phoneEncrypted: "", phoneHash: "" } }
      );

      const fresh = await col.findOne(
        { _id: card._id },
        { projection: { phoneEncrypted: 1, phoneHash: 1 } }
      );

      return res.json({
        ok: true,
        note: "Телефон в клинической карте очищен.",
        phonePlain: decrypt(fresh?.phoneEncrypted) ?? null,
        phoneEncrypted: fresh?.phoneEncrypted ?? null,
        phoneHash: fresh?.phoneHash ?? null,
      });
    }

    // ===== обычное обновление =====
    const normalized = normalizePhone(incomingRaw);
    if (!normalized) {
      return res.status(400).json({
        ok: false,
        error: "VALIDATION_ERROR",
        message: "Неверный формат номера. Используйте '+' и до 15 цифр.",
      });
    }

    // если по факту тот же номер — no-op
    if (currentPlain && currentPlain === normalized) {
      return res.json({
        ok: true,
        note: "Номер не изменён — совпадает с текущим.",
        phonePlain: currentPlain,
        phoneEncrypted: currentCipher,
        phoneHash: currentHash,
      });
    }

    // проверим дубликат по phoneHash (как в модели)
    const candidateHash = sha256Lower(normalized);
    const duplicate = await col.findOne(
      { phoneHash: candidateHash, _id: { $ne: card._id } },
      { projection: { _id: 1 } }
    );
    if (duplicate) {
      return res.status(409).json({
        ok: false,
        error: "PHONE_IN_USE",
        message: "Этот номер уже используется другим пациентом.",
      });
    }

    // шифруем и пишем напрямую (двухфазно) — никакие pre('findOneAndUpdate') не вмешаются
    const cipher = encrypt(normalized);

    await col.updateOne(
      { _id: card._id },
      { $unset: { phoneEncrypted: "", phoneHash: "" } }
    );
    await col.updateOne(
      { _id: card._id },
      { $set: { phoneEncrypted: cipher, phoneHash: candidateHash } }
    );

    const fresh = await col.findOne(
      { _id: card._id },
      { projection: { phoneEncrypted: 1, phoneHash: 1 } }
    );

    return res.json({
      ok: true,
      note: "Телефон в клинической карте обновлён.",
      phonePlain: decrypt(fresh?.phoneEncrypted) ?? null,
      phoneEncrypted: fresh?.phoneEncrypted ?? null,
      phoneHash: fresh?.phoneHash ?? null,
    });
  } catch (err) {
    console.error("❌ updatePatientChangePhoneController error:", err);

    if (err?.code === 11000) {
      return res.status(409).json({
        ok: false,
        error: "PHONE_IN_USE",
        message: "Телефон уже используется.",
      });
    }
    if (err?.name === "ValidationError") {
      return res.status(400).json({
        ok: false,
        error: "VALIDATION_ERROR",
        message:
          err?.message ||
          "Некорректные данные. Проверьте формат номера телефона.",
      });
    }
    return res.status(500).json({ ok: false, error: "SERVER_ERROR" });
  }
}
