import User from "../../../common/models/Auth/users.js";

const UsersForMessengerController = async (req, res) => {
  try {
    // Получаем всех пользователей из базы данных
    const users = await User.find();

    // Возвращаем успешный ответ с пользователями
    return res.status(200).json({
      success: true,
      data: users,
    });
  } catch (error) {
    // Обработка ошибок
    return res.status(500).json({
      success: false,
      message: "Произошла ошибка при получении пользователей",
      error: error.message,
    });
  }
};

export default UsersForMessengerController;
