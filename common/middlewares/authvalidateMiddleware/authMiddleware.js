import User from "../../../common/models/Auth/users.js";

const authMiddleware = async (req, res, next) => {
  if (req.session.userId) {
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
          user.blockedUntil
        ).toLocaleString()}`,
      });
    }

    req.user = {
      _id: user._id,
      role: user.role,
      username: user.username,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
    };

    req.userId = user._id; // ✅ вот это добавь
    return next();
  }

  return res.status(401).json({ authenticated: false });
};

export default authMiddleware;
