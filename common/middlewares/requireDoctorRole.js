// server/common/middlewares/requireDoctorRole.js
//
// «Только для врачей» — по роли аккаунта, без привязки к модулю.
//
// Отличие от authMiddleware: тот отвечает на вопрос «кто это», а этот — «имеет
// ли он право быть здесь вообще». Отличие от requirePermission/can(): те
// работают внутри клиники и опираются на членство, а здесь речь о разделах
// платформы, куда пациенту и гостю входа нет независимо от клиник.
//
// Отвечает 401, когда пользователь не вошёл, и 403, когда вошёл, но не врач:
// клиенту нужно различать «предложи войти» и «этот раздел не для тебя».

import User from "../models/Auth/users.js";

const DOCTOR_ROLES = new Set(["doctor", "admin", "superadmin"]);

export default async function requireDoctorRole(req, res, next) {
  try {
    const userId = req.session?.userId;
    if (!userId) {
      return res.status(401).json({
        success: false,
        code: "AUTH_REQUIRED",
        message: req.t("app.access.doctorsOnlyPleaseLogin"),
      });
    }

    // Роль читаем из БД, а не из сессии: сессия живёт долго, роль могли
    // изменить (или аккаунт заблокировать) уже после входа.
    const user = await User.findById(userId).select("role isBlocked").lean();

    if (!user || user.isBlocked || !DOCTOR_ROLES.has(user.role)) {
      return res.status(403).json({
        success: false,
        code: "DOCTORS_ONLY",
        message: req.t("app.access.doctorsOnly"),
      });
    }

    req.userId = userId;
    req.userRole = user.role;
    return next();
  } catch (err) {
    console.error("requireDoctorRole error:", err);
    return res
      .status(500)
      .json({ success: false, message: "Ошибка проверки доступа" });
  }
}
