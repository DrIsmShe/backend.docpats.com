const validateRegistration = (req, res, next) => {
  const {
    email,
    password,
    username,
    firstName,
    lastName,
    dateOfBirth,
    agreement,
  } = req.body;

  // Проверка на обязательные поля
  if (
    !email ||
    !password ||
    !username ||
    !firstName ||
    !lastName ||
    !dateOfBirth ||
    agreement !== true
  ) {
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
  if (!passwordRequirements.test(password)) {
    return res.status(400).json({
      message:
        "Password must be at least 8 characters long, contain at least one uppercase letter, one lowercase letter, one number, and one special character.",
    });
  }

  // Проверка формата даты рождения
  const dob = new Date(dateOfBirth);
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear(); // Изменено на let
  const monthDifference = today.getMonth() - dob.getMonth();

  // Проверка, прошел ли день рождения в текущем году
  if (
    monthDifference < 0 ||
    (monthDifference === 0 && today.getDate() < dob.getDate())
  ) {
    age--;
  }

  // Проверка, что пользователь старше 18 лет
  if (isNaN(dob.getTime()) || age < 18) {
    return res
      .status(400)
      .json({ message: "You must be at least 18 years old." });
  }

  next(); // Если валидация прошла успешно, продолжаем
};

export default validateRegistration;
