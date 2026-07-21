// server/modules/education/middlewares/educationAuth.js
//
// Авторизация модуля подготовки к экзаменам.
//
// Почему не common/auth/can.js: тот механизм построен вокруг
// ClinicMembership и AsyncLocalStorage-контекста тенанта, а education —
// ГЛОБАЛЬНЫЙ модуль. Учащийся может не состоять ни в одной клинике.
// Поэтому здесь простая лестница ролей поверх session.userId.
//
// Лестница:
//   requireLearner  — любой авторизованный пользователь (проходит тесты)
//   requireAuthor   — admin (создаёт вопросы, загружает файлы на импорт)
//   requireReviewer — admin (публикует, принимает/отклоняет ревью)
//
// ВЕСЬ редакторский контур живёт в админ-панели и закрыт ролью admin.
// Обычный пользователь — включая врача — может только проходить тесты.
// Ранее авторинг был открыт и врачам; сужено намеренно, чтобы наполнение
// банка шло через одну контролируемую точку.
//
// Когда появятся внешние авторы-врачи, работающие под ревью админа,
// добавлять их сюда: AUTHOR_ROLES = ["admin", "doctor"]. Разделение
// author/reviewer сохранено именно ради этого — и ради того, чтобы вопрос,
// извлечённый ИИ, не попал учащимся без проверки человеком
// (см. education-items/services/item.service.js → assertPublishable).

import User from "../../../common/models/Auth/users.js";
import {
  UnauthorizedError,
  ForbiddenError,
} from "../../../common/utils/errors.js";
import { asyncHandler } from "../../../common/middlewares/errorHandler.js";

// Роли User, которым разрешено писать учебный контент.
const AUTHOR_ROLES = ["admin"];
// Роли, которым разрешено рецензировать и публиковать.
const REVIEWER_ROLES = ["admin"];

/**
 * Подтягивает пользователя из сессии в req.educationActor.
 * Дальше по цепочке роль читается только отсюда — req.user может быть
 * не заполнен, если маршрут смонтирован без глобального authMiddleware.
 */
export const requireLearner = asyncHandler(async (req, res, next) => {
  const userId = req.session?.userId;
  if (!userId) throw new UnauthorizedError("Требуется авторизация");

  const user = await User.findById(userId).select("_id role isBlocked").lean();
  if (!user) throw new UnauthorizedError("Пользователь не найден");
  if (user.isBlocked) throw new ForbiddenError("Аккаунт заблокирован");

  req.educationActor = { userId: user._id, role: user.role };
  next();
});

function requireRole(allowedRoles, message) {
  return (req, res, next) => {
    const role = req.educationActor?.role;
    if (!role) return next(new UnauthorizedError("Требуется авторизация"));
    if (!allowedRoles.includes(role)) {
      return next(new ForbiddenError(message));
    }
    next();
  };
}

export const requireAuthor = requireRole(
  AUTHOR_ROLES,
  "Управление тестами доступно только из админ-панели",
);

export const requireReviewer = requireRole(
  REVIEWER_ROLES,
  "Только рецензент может публиковать учебный контент",
);

/** Хелпер для сервисов и тестов: является ли роль рецензентом. */
export function isReviewerRole(role) {
  return REVIEWER_ROLES.includes(role);
}

/** Хелпер для сервисов и тестов: может ли роль создавать учебный контент. */
export function isAuthorRole(role) {
  return AUTHOR_ROLES.includes(role);
}
