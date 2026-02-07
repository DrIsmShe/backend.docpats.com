// controllers/userController.js
import User from "../../../common/models/users.js";

const changeUserRole = async (req, res) => {
  try {
    const { userId, newRole } = req.body;

    // Проверка, что роль существует
    if (!["admin", "doctor", "patient"].includes(newRole)) {
      return res.status(400).json({ message: "Invalid role." });
    }

    // Поиск пользователя по ID
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ message: "User not found." });
    }

    // Обновление роли
    user.role = newRole;
    await user.save();

    res.status(200).json({ message: "Role updated successfully.", user });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Server error." });
  }
};

export default changeUserRole;
