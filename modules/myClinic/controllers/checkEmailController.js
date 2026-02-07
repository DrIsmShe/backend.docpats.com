import User from "../../../common/models/Auth/users.js";

const checkEmailController = async (req, res) => {
  try {
    const { email, fullName } = req.query; // Получаем email и имя пациента

    let user = await User.findOne({ email });

    if (user) {
      const userFullName = `${user.firstName} ${user.lastName}`.trim(); // Формируем имя пользователя

      if (userFullName.toLowerCase() === fullName.toLowerCase()) {
        return res.json({
          exists: true,
          isSamePerson: true,
          fullName: userFullName,
        });
      } else {
        return res.json({
          exists: true,
          isSamePerson: false,
          fullName: userFullName,
        });
      }
    } else {
      return res.json({ exists: false });
    }
  } catch (error) {
    console.error("Ошибка при проверке email:", error);
    return res.status(500).json({ message: "Ошибка сервера." });
  }
};

export default checkEmailController;
