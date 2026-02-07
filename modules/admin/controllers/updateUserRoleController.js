import User from "../../../common/models/Auth/users.js"; // Предположим, что вы используете Mongoose для работы с базой данных

// Контроллер для изменения роли пользователя
const updateUserRoleController = async (req, res) => {
  const { id } = req.params; // Получаем ID пользователя из параметров маршрута
  const { newRole } = req.body; // Получаем новую роль из тела запроса

  try {
    // Находим пользователя по ID
    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Update the role
    user.role = newRole;
    await user.save();
    console.log("User ID:", req.params.id);
    console.log("Request body:", req.body);
    res.status(200).json({ message: "Role successfully updated", user });
  } catch (error) {
    console.error("Error changing user role:", error);
    res.status(500).json({ message: "Error changing role", error });
  }
};
export default updateUserRoleController;
