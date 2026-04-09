const validateRegistration = (req, res, next) => {
  const {
    email,
    password,
    username,
    firstName,
    lastName,
    dateOfBirth,
    agreement,
    role,
    parentEmail,
  } = req.body;

  /* -------------------------------------------------------
     1. Проверка обязательных полей
  ------------------------------------------------------- */
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

  /* -------------------------------------------------------
     2. Проверка формата email
  ------------------------------------------------------- */
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  if (!emailRegex.test(email)) {
    return res.status(400).json({ message: "Invalid email format." });
  }

  /* -------------------------------------------------------
     3. Проверка пароля (международный стандарт)
  ------------------------------------------------------- */
  const passwordRequirements =
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&]).{8,}$/;

  if (!passwordRequirements.test(password)) {
    return res.status(400).json({
      message:
        "Password must be at least 8 characters long, contain uppercase, lowercase, number and special character.",
    });
  }

  /* -------------------------------------------------------
     4. Определяем возраст
  ------------------------------------------------------- */
  const dob = new Date(dateOfBirth);
  const today = new Date();

  let age = today.getFullYear() - dob.getFullYear();
  const month = today.getMonth() - dob.getMonth();

  if (month < 0 || (month === 0 && today.getDate() < dob.getDate())) {
    age--;
  }

  if (isNaN(dob.getTime())) {
    return res.status(400).json({ message: "Invalid date of birth." });
  }

  /* -------------------------------------------------------
     5. Доктор — строго 18+
  ------------------------------------------------------- */
  if (role === "doctor" && age < 18) {
    return res.status(400).json({
      message: "Doctor must be at least 18 years old.",
    });
  }

  /* -------------------------------------------------------
     6. Пациент младше 18 → нужен parentEmail
        (твой контроллер registerUser пока НЕ использует parentEmail,
        но middleware готовит данные для будущей логики)
  ------------------------------------------------------- */
  if (role === "patient" && age < 18) {
    if (!parentEmail) {
      return res
        .status(400)
        .json({ message: "Parent email is required for underage patients." });
    }

    if (!emailRegex.test(parentEmail)) {
      return res.status(400).json({ message: "Invalid parent email format." });
    }

    if (parentEmail === email) {
      return res.status(400).json({
        message: "Parent email cannot be the same as child's email.",
      });
    }
  }

  /* -------------------------------------------------------
     Всё хорошо → отправляем дальше
  ------------------------------------------------------- */
  next();
};

export default validateRegistration;
