import User from "../../../common/models/Auth/users.js";
import crypto from "crypto";
import "dotenv/config";
import { acceptInvitation } from "../../clinic/clinic-staff/services/clinicMembershipInvite.service.js";

const SECRET_KEY =
  process.env.ENCRYPTION_KEY?.padEnd(32, "0") ||
  "0940e085024139b46bde566fafbddd63";

const hashData = (data) => {
  return crypto.createHash("sha256").update(data.toLowerCase()).digest("hex");
};

// H-3: сравнение OTP за постоянное время (защита от timing-атаки).
const otpMatches = (provided, stored) => {
  if (!provided || !stored) return false;
  const a = crypto.createHash("sha256").update(String(provided).trim()).digest();
  const b = crypto.createHash("sha256").update(String(stored).trim()).digest();
  return crypto.timingSafeEqual(a, b);
};

const decrypt = (text) => {
  if (!text || !text.includes(":")) {
    console.error("❌ [DECRYPT ERROR] Invalid encrypted data format:", text);
    return null;
  }

  try {
    const [iv, encryptedText] = text.split(":");

    if (!iv || iv.length !== 32) {
      console.error("❌ [DECRYPT ERROR] Invalid IV length:", iv);
      return null;
    }

    const decipher = crypto.createDecipheriv(
      "aes-256-cbc",
      Buffer.from(SECRET_KEY),
      Buffer.from(iv, "hex"),
    );

    let decrypted = decipher.update(Buffer.from(encryptedText, "hex"));
    decrypted = Buffer.concat([decrypted, decipher.final()]);

    return decrypted.toString();
  } catch (error) {
    console.error("❌ [DECRYPT ERROR] Decryption failed:", error.message);
    return null;
  }
};

export const confirmationRegister = async (req, res) => {
  // inviteToken (optional): present only when the person is registering via a
  // clinic membership invite link (?invite=<token>). Variant C — the token is
  // carried by the frontend across register → confirm and is NEVER stored in
  // the DB. We bind the membership only AFTER the account is verified.
  const { email, otpPassword, inviteToken } = req.body;

  if (!email || !otpPassword) {
    return res.status(400).json({ message: "All fields are required." });
  }

  try {
    const user = await User.findOne({ emailHash: hashData(email) });

    // M-4: одинаковый ответ для «нет пользователя» и «неверный/просроченный код»
    // — по этому эндпоинту нельзя перечислять зарегистрированные email.
    const invalid = () =>
      res
        .status(400)
        .json({ message: "Invalid or expired confirmation code." });

    if (!user) return invalid();

    // H-3: код должен существовать, не истечь (otpExpiresAt пишется при
    // регистрации) и совпасть по постоянному времени.
    const notExpired =
      user.otpExpiresAt && Number(user.otpExpiresAt) > Date.now();

    if (
      user.otpPassword &&
      notExpired &&
      otpMatches(otpPassword, user.otpPassword)
    ) {
      user.isVerified = true;
      user.otpPassword = undefined;
      user.otpExpiresAt = undefined;
      await user.save({ validateModifiedOnly: true });

      // ── Optional: bind a pending clinic membership invite ──────────────
      // Non-blocking: a bad/expired/mismatched invite must NOT fail the
      // verification. The account is already verified above. The service
      // enforces variant-2 safeguards (strict token binding + assert the
      // user's email === invite email), so no extra checks are needed here.
      // If binding fails, the person can still accept later via the
      // authenticated accept endpoint using the same link.
      let inviteResult = null;
      if (inviteToken) {
        try {
          const r = await acceptInvitation({
            token: inviteToken,
            userId: user._id,
          });
          inviteResult = {
            accepted: true,
            clinicId: r.clinicId,
            role: r.role,
            alreadyMember: r.alreadyMember,
          };
        } catch (inviteErr) {
          inviteResult = {
            accepted: false,
            reason: inviteErr?.message?.slice(0, 200) || "invite bind failed",
          };
          console.warn(
            "[register] membership invite bind failed:",
            inviteResult.reason,
          );
        }
      }

      return res.status(200).json({
        message: "OTP verified successfully",
        ...(inviteResult ? { invite: inviteResult } : {}),
      });
    } else {
      return invalid();
    }
  } catch (error) {
    console.error("❌ [ERROR] OTP verification failed:", error);
    // M-3: не раскрываем внутренний объект ошибки клиенту.
    return res.status(500).json({ message: "OTP verification failed" });
  }
};
