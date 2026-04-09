import User from "../../../common/models/Auth/users.js";

const authMiddleware = async (req, res, next) => {
  try {
    if (!req.session?.userId) {
      return res.status(401).json({ authenticated: false });
    }

    const user = await User.findById(req.session.userId);

    if (!user) {
      return res.status(401).json({ authenticated: false });
    }

    if (user.permanentlyBanned) {
      return res
        .status(403)
        .json({ message: "Ваш аккаунт заблокирован навсегда" });
    }

    if (user.blockedUntil && user.blockedUntil > new Date()) {
      return res.status(403).json({
        message: `Вы заблокированы до ${new Date(
          user.blockedUntil,
        ).toLocaleString()}`,
      });
    }

    // 🔥 КЛЮЧЕВОЕ ИЗМЕНЕНИЕ
    // Передаём полноценный mongoose документ
    req.user = user;

    // Для совместимости со старым кодом
    req.userId = user._id;

    return next();
  } catch (err) {
    console.error("Auth middleware error:", err);
    return res.status(500).json({ message: "Auth error" });
  }
};

export default authMiddleware;
