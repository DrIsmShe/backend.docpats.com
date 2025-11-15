import mongoose from "mongoose";
import User from "../../../common/models/Auth/users.js";

const updateMainProfileControllerDoctor = async (req, res) => {
  try {
    const { userId, avatar, username, firstName, lastName, dateOfBirth, bio } =
      req.body;

    // Проверка корректности ObjectId
    if (!mongoose.Types.ObjectId.isValid(userId)) {
      return res.status(400).json({ message: "Incorrect ID format" });
    }

    // Check if the user exists
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Check username (without special characters)
    if (username && !/^[a-zA-Z0-9_-]{3,20}$/.test(username)) {
      return res.status(400).json({
        message:
          "Username can only contain letters, numbers, '-', '_', from 3 to 20 characters.",
      });
    }

    // Ограничение длины bio
    if (bio && bio.length > 500) {
      return res
        .status(400)
        .json({ message: "Bio must not exceed 500 characters." });
    }

    // Обрезаем пробелы у строковых данных
    const sanitizedData = {
      avatar: avatar?.trim() || user.avatar,
      username: username?.trim() || user.username,
      firstName: firstName?.trim() || user.firstName,
      lastName: lastName?.trim() || user.lastName,
      dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : user.dateOfBirth,
      bio: bio?.trim() || user.bio,
    };

    // Обновляем профиль пользователя
    const updatedUser = await User.findByIdAndUpdate(userId, sanitizedData, {
      new: true,
    });

    res
      .status(200)
      .json({ message: "Profile successfully updated", user: updatedUser });
  } catch (error) {
    console.error("Error updating profile:", error);
    res
      .status(500)
      .json({ message: "Error on the server", error: error.message });
  }
};

export default updateMainProfileControllerDoctor;
