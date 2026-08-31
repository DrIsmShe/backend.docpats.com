import crypto from "crypto";
import dotenv from "dotenv";
import argon2 from "argon2";
import User from "../../../common/models/Auth/users.js";

dotenv.config();

const SECRET_KEY = process.env.ENCRYPTION_KEY?.padEnd(32, "0");
if (!SECRET_KEY || SECRET_KEY.length !== 32) {
  throw new Error(req.t("app.config.encryptionKeyInvalid"));
}

const changePasswordProfileOfPatientController = async (req, res) => {
  try {
    const { currentPassword, newPassword, renewPassword } = req.body;

    if (!req.session.userId) {
      console.log("Ошибка: пользователь не аутентифицирован.");
      return res
        .status(403)
        .json({ message: req.t("app.auth.pleaseLogin") });
    }

    // H-2: НЕ логируем req.body — там пароли (утечка секретов в логи).

    if (!currentPassword || !newPassword || !renewPassword) {
      return res.status(400).json({ message: req.t("app.validation.allFieldsRequired") });
    }

    if (newPassword !== renewPassword) {
      return res
        .status(400)
        .json({ message: req.t("app.password.confirmationMismatch") });
    }

    if (newPassword.length < 8) {
      return res
        .status(400)
        .json({ message: req.t("app.password.minLength") });
    }

    const existingUser = await User.findById(req.session.userId);
    if (!existingUser) {
      return res.status(404).json({ message: req.t("app.user.notFound2") });
    }

    const isCurrentPasswordValid = await argon2.verify(
      existingUser.password,
      currentPassword
    );
    if (!isCurrentPasswordValid) {
      return res.status(400).json({ message: req.t("app.password.currentIncorrect") });
    }

    if (await argon2.verify(existingUser.password, newPassword)) {
      return res
        .status(400)
        .json({ message: req.t("app.password.mustBeDifferent") });
    }

    const hashedPassword = await argon2.hash(newPassword, {
      timeCost: 3,
      memoryCost: 2 ** 17,
      parallelism: 1,
      type: argon2.argon2id,
    });

    existingUser.password = hashedPassword;
    await existingUser.save();

    return res.status(200).json({ message: req.t("app.password.changeSuccess") });
  } catch (error) {
    console.error("Ошибка при изменении пароля: ", error);
    return res.status(500).json({
      message: req.t("app.password.changeError"),
      error: error.message,
    });
  }
};

export default changePasswordProfileOfPatientController;
