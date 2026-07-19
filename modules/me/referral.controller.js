// server/modules/me/referral.controller.js
//
// Шаг 1 реферальной программы: у каждого пользователя есть личный код-
// приглашение. Эндпоинт возвращает код и готовую ссылку (для кнопки
// «Пригласить» и QR на фронте). Код генерится лениво при первом запросе.

import crypto from "crypto";
import User from "../../common/models/Auth/users.js";

const isProduction = process.env.NODE_ENV === "production";
const FRONTEND_URL =
  process.env.FRONTEND_URL ||
  (isProduction ? "https://docpats.com" : "http://localhost:3000");

// 8-символьный код без легко путаемых символов.
function genCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // без 0/O/1/I
  let out = "";
  const bytes = crypto.randomBytes(8);
  for (let i = 0; i < 8; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

export async function getMyReferral(req, res) {
  try {
    const userId = req.session?.userId;
    if (!userId) {
      return res.status(401).json({ success: false, message: "Not authenticated" });
    }

    const user = await User.findById(userId).select(
      "referralCode referralCount referralBonusDays bonusConsultations",
    );
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    // Ленивая генерация уникального кода (несколько попыток на случай коллизии).
    if (!user.referralCode) {
      for (let i = 0; i < 6; i++) {
        const code = genCode();
        const taken = await User.exists({ referralCode: code });
        if (!taken) {
          user.referralCode = code;
          break;
        }
      }
      await user.save({ validateModifiedOnly: true });
    }

    const code = user.referralCode;
    return res.status(200).json({
      success: true,
      code,
      url: `${FRONTEND_URL}/registration?ref=${code}`,
      referralCount: user.referralCount || 0,
      bonusDays: user.referralBonusDays || 0,
      bonusConsultations: user.bonusConsultations || 0,
    });
  } catch (err) {
    console.error("getMyReferral error:", err.message);
    return res.status(500).json({ success: false, message: "Server error" });
  }
}
