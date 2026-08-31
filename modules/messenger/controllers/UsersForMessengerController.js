import User from "../../../common/models/Auth/users.js";
import { tReq } from "../../../common/i18n/index.js";

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
      message: tReq(req, "app.users.fetchError"),
      error: error.message,
    });
  }
};

export default UsersForMessengerController;
