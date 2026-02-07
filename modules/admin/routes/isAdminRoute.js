// server/modules/admin/routes/isAdminRoute.js
import User from "../../../common/models/Auth/users.js";

export async function requireAdmin(req, res, next) {
  try {
    const userId = req.session?.userId;
    if (!userId) {
      return res.status(401).json({ message: "Unauthorized access" });
    }

    // 1 запрос в БД на каждый админский маршрут
    const user = await User.findById(userId).lean();
    if (!user) return res.status(404).json({ message: "User not found" });
    if (user.role !== "admin")
      return res.status(403).json({ message: "Access denied" });

    // пробрасываем полезное
    req.userId = user._id.toString();
    req.userRole = user.role;
    next();
  } catch (err) {
    console.error("requireAdmin error:", err);
    res.status(500).json({ message: "Server error" });
  }
}

// (по желанию) дефолтный экспорт, если где-то уже импортировали default
export default requireAdmin;
