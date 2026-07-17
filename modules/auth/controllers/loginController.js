import User from "../../../common/models/Auth/users.js";
import DoctorProfileModel from "../../../common/models/DoctorProfile/profileDoctor.js";
import PatientProfileModel from "../../../common/models/PatientProfile/patientProfile.js";
import { recordActionAsync } from "../../audit/index.js";
import argon2 from "argon2";
import crypto from "crypto";
import "dotenv/config";

// ---------------- CRYPTO ----------------
const SECRET_KEY = (process.env.ENCRYPTION_KEY || "")
  .padEnd(32, "0")
  .slice(0, 32);

const hashData = (data) =>
  crypto.createHash("sha256").update(data.toLowerCase()).digest("hex");

// H-1: блокировка учётки при переборе пароля (как у сотрудников клиник,
// employeeAuth.service.js). Поля failedLoginAttempts/lockoutUntil есть в модели.
const MAX_FAILED_LOGIN_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

// L-1: чтобы время ответа при несуществующем email не отличалось от реального
// (argon2.verify занимает заметное время), прогоняем dummy-verify. Хэш считаем
// один раз и кэшируем.
let dummyHashPromise = null;
const getDummyHash = () => {
  if (!dummyHashPromise) {
    dummyHashPromise = argon2.hash("timing-equalizer-dummy", {
      type: argon2.argon2id,
      timeCost: 3,
      memoryCost: 2 ** 16,
      parallelism: 1,
    });
  }
  return dummyHashPromise;
};

const decrypt = (text) => {
  if (!text || !text.includes(":")) return text;
  try {
    const [iv, encryptedText] = text.split(":");
    const decipher = crypto.createDecipheriv(
      "aes-256-cbc",
      Buffer.from(SECRET_KEY),
      Buffer.from(iv, "hex"),
    );
    let decrypted = decipher.update(Buffer.from(encryptedText, "hex"));
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
  } catch (error) {
    console.error("❌ Email decryption error:", error.message);
    return null;
  }
};

// ---------------- LOGIN CONTROLLER ----------------
export const loginUser = async (req, res) => {
  const { email, password, remember } = req.body;

  if (!email || !password) {
    return res
      .status(400)
      .json({ message: "Email and password are required." });
  }

  try {
    // === Ищем пользователя по хэшу email ===
    const user = await User.findOne({ emailHash: hashData(email) });

    if (!user) {
      // L-1: выравниваем тайминг — считаем argon2 и при несуществующем email.
      await argon2.verify(await getDummyHash(), password).catch(() => false);
      return res.status(400).json({ message: "Incorrect email or password." });
    }

    const decryptedEmail = decrypt(user.emailEncrypted);

    // 🔥 ДЕТИ: блокируем вход, если родитель ещё не подтвердил
    if (user.isChild && user.childStatus !== "active") {
      return res.status(403).json({
        message: "Child account is not yet activated by parent.",
      });
    }

    // 🔥 Аккаунт заблокирован
    if (user.isBlocked) {
      return res
        .status(403)
        .json({ message: "Your account has been blocked." });
    }

    // 🔥 H-1: учётка временно заперта из-за перебора пароля
    if (user.lockoutUntil && new Date(user.lockoutUntil).getTime() > Date.now()) {
      const retryAfterMinutes = Math.max(
        1,
        Math.ceil((new Date(user.lockoutUntil).getTime() - Date.now()) / 60000),
      );
      return res.status(403).json({
        message:
          "Account is temporarily locked after several failed attempts.",
        code: "ACCOUNT_LOCKED",
        retryAfterMinutes,
      });
    }

    // 🔥 Проверка пароля
    const validPassword = await argon2.verify(user.password, password);
    if (!validPassword) {
      // H-1: копим неудачные попытки; на лимите — запираем на LOCKOUT_MINUTES.
      user.failedLoginAttempts = (user.failedLoginAttempts || 0) + 1;
      if (user.failedLoginAttempts >= MAX_FAILED_LOGIN_ATTEMPTS) {
        user.lockoutUntil = new Date(Date.now() + LOCKOUT_MINUTES * 60 * 1000);
        user.failedLoginAttempts = 0;
      }
      try {
        await user.save({ validateModifiedOnly: true });
      } catch (e) {
        console.error("❌ Не удалось сохранить счётчик попыток входа");
      }
      return res.status(400).json({ message: "Incorrect email or password." });
    }

    // Успешный ввод пароля — сбрасываем счётчик/локаут.
    if (user.failedLoginAttempts || user.lockoutUntil) {
      user.failedLoginAttempts = 0;
      user.lockoutUntil = null;
    }

    // 🔥 Система принудительной смены пароля
    if (user.mustChangePassword) {
      return res.status(403).json({
        message: "Password change required.",
        mustChangePassword: true,
      });
    }

    // === Обновляем статус пользователя ===
    user.status = "online";
    user.lastActive = new Date();
    await user.save({ validateModifiedOnly: true });

    // === Профиль врача/пациента ===
    let profileData = null;
    if (user.role === "doctor") {
      profileData = await DoctorProfileModel.findOne({ userId: user._id });
    } else if (user.role === "patient") {
      profileData = await PatientProfileModel.findOne({ userId: user._id });
    }

    // === СЕССИЯ ===
    // NB: session.regenerate() здесь ломало вход в cross-origin проде
    // (Netlify docpats.com → backend.docpats.com, sameSite=none): новая сессия
    // не персистилась и пользователя выкидывало. Защиту от session fixation
    // нужно возвращать отдельно и аккуратно под текущую cookie-конфигурацию.
    req.session.cookie.maxAge = remember
      ? 30 * 24 * 60 * 60 * 1000
      : 14 * 24 * 60 * 60 * 1000;

    req.session.userId = user._id.toString();

    req.session.username = user.username;
    req.session.email = decryptedEmail;
    req.session.firstName = user.firstName;
    req.session.lastName = user.lastName;
    req.session.role = user.role;
    req.session.status = "online";

    await new Promise((resolve, reject) => {
      req.session.save((err) => {
        if (err) return reject(err);
        resolve();
      });
    });

    // === АУДИТ (Sprint Cleanup Phase 4) ===
    // Заменяет legacy AuditLog.create() → canonical recordActionAsync()
    // пишущий в hipaa_audit_logs. Те же данные что и раньше.
    recordActionAsync({
      actor: {
        userId: user._id,
        email: user.email,
        role: user.role,
      },
      action: "auth.login",
      resourceType: "user-account",
      resourceId: user._id,
      metadata: {
        username: user.username,
        details: `User ${user.username} logged in successfully.`,
      },
      context: {
        ipAddress: req.ip || req.connection?.remoteAddress,
      },
    });

    // === Ответ ===
    return res.status(200).json({
      message: "Login successful",
      user: {
        id: user._id,
        username: user.username,
        email: decryptedEmail,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        status: "online",
        profileData,
      },
    });
  } catch (error) {
    console.error("❌ Authorization error:", error);
    // Не отдаём error.message наружу — внутренние детали не должны утекать клиенту.
    return res.status(500).json({ message: "Login error" });
  }
};
