import User from "../../../common/models/Auth/users.js"; // Импорт вашей модели пользователя

const deleteUserController = async (req, res) => {
  try {
    const { id } = req.params; // Получаем ID пользователя из параметров URL

    // Проверка существования пользователя
    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Удаление пользователя
    await User.findByIdAndDelete(id);

    res.status(200).json({ message: "User deleted successfully" });
  } catch (error) {
    console.error("Error deleting user:", error);
    res
      .status(500)
      .json({ message: "An error occurred while deleting the user" });
  }
};

export default deleteUserController;
