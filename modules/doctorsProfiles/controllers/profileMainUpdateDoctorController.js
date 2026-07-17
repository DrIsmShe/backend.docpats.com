import mongoose from "mongoose";
import User from "../../../common/models/Auth/users.js";
import { uploadFile } from "../../../common/middlewares/uploadMiddleware.js"; // ← правильно

const updateMainProfileControllerDoctor = async (req, res) => {
  try {
    // 🔒 БЕЗОПАСНОСТЬ: userId берём ТОЛЬКО из сессии (authMiddleware ставит
    // req.userId). Никогда из req.body — иначе можно править чужой профиль.
    const userId = req.userId;
    const { username, firstName, lastName, dateOfBirth, bio } = req.body;

    if (!userId || !mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (username && !/^[a-zA-Z0-9_-]{3,20}$/.test(username)) {
      return res.status(400).json({
        message:
          "Username can only contain letters, numbers, '-', '_', from 3 to 20 characters.",
      });
    }

    // 🔒 Уникальность username — обязательна. Проверяем, что новый username не
    // занят другим пользователем (unique-индекс в модели — вторая линия защиты).
    if (username && username.trim() !== user.username) {
      const taken = await User.findOne({
        username: username.trim(),
        _id: { $ne: userId },
      })
        .select("_id")
        .lean();
      if (taken) {
        return res.status(409).json({
          message: "This username is already taken.",
          code: "USERNAME_TAKEN",
        });
      }
    }

    if (bio && bio.length > 500) {
      return res
        .status(400)
        .json({ message: "Bio must not exceed 500 characters." });
    }

    let avatarUrl = user.avatar;

    // 🔥 Если загружен файл — грузим в R2 через uploadFile
    if (req.file) {
      avatarUrl = await uploadFile(req.file); // ← РАБОТАЕТ
    }

    const sanitizedData = {
      avatar: avatarUrl,
      username: username?.trim() || user.username,
      dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : user.dateOfBirth,
      bio: bio?.trim() || user.bio,
    };

    // Имя/фамилия хранятся зашифрованными (firstNameEncrypted/lastNameEncrypted).
    // Пишем в *Encrypted-поля plaintext — pre("findOneAndUpdate") хук зашифрует
    // их и пересчитает blind-index хэши. Раньше писали в firstName/lastName,
    // которых нет в схеме → strict-mode их отбрасывал и имя не менялось.
    if (firstName?.trim()) sanitizedData.firstNameEncrypted = firstName.trim();
    if (lastName?.trim()) sanitizedData.lastNameEncrypted = lastName.trim();

    const updatedUser = await User.findByIdAndUpdate(userId, sanitizedData, {
      new: true,
    });

    res.status(200).json({
      message: "Profile successfully updated",
      user: updatedUser,
    });
  } catch (error) {
    console.error("Error updating profile:", error);
    // Подстраховка от гонки: если unique-индекс отклонил дубликат username.
    if (error?.code === 11000 && error?.keyPattern?.username) {
      return res.status(409).json({
        message: "This username is already taken.",
        code: "USERNAME_TAKEN",
      });
    }
    // Не раскрываем внутренние детали ошибки клиенту.
    res.status(500).json({ message: "Error on the server" });
  }
};

export default updateMainProfileControllerDoctor;
