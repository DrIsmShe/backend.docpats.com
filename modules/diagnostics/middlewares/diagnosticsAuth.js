// server/modules/diagnostics/middlewares/diagnosticsAuth.js
//
// Авторизация модуля диагностической помощи.
//
// Устроена как у education и radiology (модуль глобальный, common/auth/can.js
// завязан на ClinicMembership), но с одним отличием: здесь НЕ «любой
// авторизованный». Материалы живых пациентов и разбор для клинической работы —
// это инструмент врача, а не всех подряд.
//
// Пациентов сюда не пускаем сознательно: разбор без врача превращается в
// самодиагностику по интернету, только с более убедительным тоном.

import User from "../../../common/models/Auth/users.js";
import {
  UnauthorizedError,
  ForbiddenError,
} from "../../../common/utils/errors.js";
import { asyncHandler } from "../../../common/middlewares/errorHandler.js";

const CLINICIAN_ROLES = ["doctor", "admin"];

export const requireClinician = asyncHandler(async (req, res, next) => {
  const userId = req.session?.userId;
  if (!userId) throw new UnauthorizedError("Требуется авторизация");

  const user = await User.findById(userId).select("_id role isBlocked").lean();
  if (!user) throw new UnauthorizedError("Пользователь не найден");
  if (user.isBlocked) throw new ForbiddenError("Аккаунт заблокирован");
  if (!CLINICIAN_ROLES.includes(user.role)) {
    throw new ForbiddenError("Раздел доступен врачам: разбор материалов ведёт врач");
  }

  req.diagnosticsActor = {
    userId: user._id,
    role: user.role,
    // Клиника, если врач работает в её контексте: проставляет
    // tenantMiddleware выше по стеку, если он был применён.
    clinicId: req.session?.clinicId ?? null,
  };
  next();
});
