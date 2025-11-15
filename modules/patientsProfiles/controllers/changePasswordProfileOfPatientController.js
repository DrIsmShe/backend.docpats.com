import crypto from "crypto";
import dotenv from "dotenv";
import argon2 from "argon2";
import User from "../../../common/models/Auth/users.js";

dotenv.config();

const SECRET_KEY = process.env.ENCRYPTION_KEY?.padEnd(32, "0");
if (!SECRET_KEY || SECRET_KEY.length !== 32) {
  throw new Error("❌ Ошибка: ENCRYPTION_KEY не найден или некорректен!");
}

const changePasswordProfileOfPatientController = async (req, res) => {
  try {
    const { currentPassword, newPassword, renewPassword } = req.body;

    if (!req.session.userId) {
      console.log("Ошибка: пользователь не аутентифицирован.");
      return res
        .status(403)
        .json({ message: "Пожалуйста, войдите в систему." });
    }

    console.log("Контроллер changePasswordProfileOfPatientController вызван");
    console.log("Данные запроса:", req.body);

    if (!currentPassword || !newPassword || !renewPassword) {
      return res.status(400).json({ message: "Все поля обязательны." });
    }

    if (newPassword !== renewPassword) {
      return res
        .status(400)
        .json({ message: "Новый пароль и подтверждение не совпадают." });
    }

    if (newPassword.length < 8) {
      return res
        .status(400)
        .json({ message: "Пароль должен содержать минимум 8 символов." });
    }

    const existingUser = await User.findById(req.session.userId);
    if (!existingUser) {
      return res.status(404).json({ message: "Пользователь не найден." });
    }

    const isCurrentPasswordValid = await argon2.verify(
      existingUser.password,
      currentPassword
    );
    if (!isCurrentPasswordValid) {
      return res.status(400).json({ message: "Текущий пароль неверен." });
    }

    if (await argon2.verify(existingUser.password, newPassword)) {
      return res
        .status(400)
        .json({ message: "Новый пароль не должен совпадать с текущим." });
    }

    const hashedPassword = await argon2.hash(newPassword, {
      timeCost: 3,
      memoryCost: 2 ** 17,
      parallelism: 1,
      type: argon2.argon2id,
    });

    existingUser.password = hashedPassword;
    await existingUser.save();

    return res.status(200).json({ message: "Пароль успешно изменён." });
  } catch (error) {
    console.error("Ошибка при изменении пароля: ", error);
    return res.status(500).json({
      message: "Произошла ошибка при изменении пароля.",
      error: error.message,
    });
  }
};

export default changePasswordProfileOfPatientController;
