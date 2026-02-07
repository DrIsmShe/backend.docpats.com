const validatePassword = (req, res, next) => {
  const { email, newPassword, newRepeatPassword } = req.body;

  // Проверка на обязательные поля
  if (!email || !newPassword || !newRepeatPassword == true) {
    return res
      .status(400)
      .json({ message: "All fields are required and agreement must be true." });
  }

  // Проверка формата email
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ message: "Invalid email format." });
  }

  // Проверка длины пароля и наличия обязательных символов
  const passwordRequirements =
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&]).{8,}$/;
  if (!passwordRequirements.test(newPassword)) {
    return res.status(400).json({
      message:
        "Password must be at least 8 characters long, contain at least one uppercase letter, one lowercase letter, one number, and one special character.",
    });
  }

  next(); // Если валидация прошла успешно, продолжаем
};

export default validatePassword;
