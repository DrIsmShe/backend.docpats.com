// server/modules/radiology/middlewares/radiologyAuth.js
//
// Авторизация модуля лучевой диагностики. Устроена так же, как
// education/middlewares/educationAuth.js, и по той же причине: модуль
// ГЛОБАЛЬНЫЙ (аудитория — врачи/резиденты вне клиники), поэтому
// common/auth/can.js (завязанный на ClinicMembership) здесь не подходит.
//
// Лестница:
//   requireLearner  — любой авторизованный (проходит кейсы)
//   requireAuthor   — admin (создаёт кейсы, размечает эталон)
//   requireReviewer — admin (публикует, принимает/отклоняет ревью)
//
// Когда появятся внешние авторы-рентгенологи под ревью админа — добавлять
// их в AUTHOR_ROLES; разделение author/reviewer сохранено ради этого.

import User from "../../../common/models/Auth/users.js";
import {
  UnauthorizedError,
  ForbiddenError,
} from "../../../common/utils/errors.js";
import { asyncHandler } from "../../../common/middlewares/errorHandler.js";

const AUTHOR_ROLES = ["admin"];
const REVIEWER_ROLES = ["admin"];

export const requireLearner = asyncHandler(async (req, res, next) => {
  const userId = req.session?.userId;
  if (!userId) throw new UnauthorizedError("Требуется авторизация");

  const user = await User.findById(userId).select("_id role isBlocked").lean();
  if (!user) throw new UnauthorizedError("Пользователь не найден");
  if (user.isBlocked) throw new ForbiddenError("Аккаунт заблокирован");

  req.radiologyActor = { userId: user._id, role: user.role };
  next();
});

function requireRole(allowedRoles, message) {
  return (req, res, next) => {
    const role = req.radiologyActor?.role;
    if (!role) return next(new UnauthorizedError("Требуется авторизация"));
    if (!allowedRoles.includes(role)) return next(new ForbiddenError(message));
    next();
  };
}

export const requireAuthor = requireRole(
  AUTHOR_ROLES,
  "Управление кейсами доступно только из админ-панели",
);

export const requireReviewer = requireRole(
  REVIEWER_ROLES,
  "Только рецензент может публиковать учебный контент",
);

export function isReviewerRole(role) {
  return REVIEWER_ROLES.includes(role);
}
export function isAuthorRole(role) {
  return AUTHOR_ROLES.includes(role);
}
