import User from "../../common/models/Auth/users.js";
import NewPatientPolyclinic from "../../common/models/Polyclinic/newPatientPolyclinic.js";

const authMiddleware = async (req, res, next) => {
  try {
    if (!req.session || !req.session.userId) {
      return res
        .status(401)
        .json({ authenticated: false, message: "Вы не авторизованы" });
    }

    const user = await User.findById(req.session.userId);
    if (!user) {
      return res
        .status(401)
        .json({ authenticated: false, message: "Пользователь не найден" });
    }

    // 🧩 Проверяем, есть ли у пациента профиль в поликлинике
    let patientPolyclinic = null;
    if (user.role === "patient") {
      patientPolyclinic = await NewPatientPolyclinic.findOne({
        $or: [{ linkedUserId: user._id }, { userId: user._id }],
      }).select("_id");
    }

    req.userId = user._id;
    req.user = {
      userId: user._id,
      username: user.username,
      email: user.email,
      role: user.role,
      firstName: user.firstNameEncrypted,
      lastName: user.lastNameEncrypted,
      patientPolyclinicId: patientPolyclinic?._id || null, // ✅ добавляем сюда!
    };

    next();
  } catch (err) {
    console.error("❌ Ошибка в authMiddleware:", err.message);
    return res.status(500).json({ message: "Внутренняя ошибка сервера" });
  }
};

export default authMiddleware;
