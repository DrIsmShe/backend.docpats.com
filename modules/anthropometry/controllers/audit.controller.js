import auditService from "../services/audit.service.js";
import { ForbiddenError } from "../utils/errors.js";

/* ============================================================
   AUDIT CONTROLLERS
   ============================================================
   Compliance endpoints для админ-панели.

   TODO: добавить middleware requireRole("admin"|"compliance")
   после того как разберёмся с системой ролей в проекте.
   Пока — basic check на уровне controller (сравнение userId). */

const isAdmin = (actor) => {
  // Заглушка — пока проверяем по полю role.
  // В будущем — отдельный middleware.
  return actor.role === "admin" || actor.role === "compliance_officer";
};

/* GET /audit/cases/:caseId */
export const getCaseHistory = async (req, res, next) => {
  try {
    if (!isAdmin(req.actor)) {
      throw new ForbiddenError(
        "audit history",
        "admin or compliance_officer role required",
      );
    }

    const history = await auditService.getCaseHistory({
      caseId: req.params.caseId,
      limit: req.query.limit,
      skip: req.query.skip,
    });
    res.status(200).json({ data: history });
  } catch (err) {
    next(err);
  }
};

/* GET /audit/users/:userId */
export const getUserActivity = async (req, res, next) => {
  try {
    const targetUserId = req.params.userId;
    const isOwnActivity = targetUserId === req.actor.userId;

    // Доктор может смотреть только свою историю,
    // админ — любую
    if (!isOwnActivity && !isAdmin(req.actor)) {
      throw new ForbiddenError(
        "user activity",
        "you can only view your own activity",
      );
    }

    const activity = await auditService.getUserActivity({
      userId: targetUserId,
      action: req.query.action,
      from: req.query.from,
      to: req.query.to,
      limit: req.query.limit,
      skip: req.query.skip,
    });
    res.status(200).json({ data: activity });
  } catch (err) {
    next(err);
  }
};

/* GET /audit/denied */
export const getDeniedAttempts = async (req, res, next) => {
  try {
    if (!isAdmin(req.actor)) {
      throw new ForbiddenError(
        "denied attempts log",
        "admin or compliance_officer role required",
      );
    }

    const denied = await auditService.getDeniedAttempts({
      from: req.query.from,
      to: req.query.to,
      userId: req.query.userId,
      limit: req.query.limit,
      skip: req.query.skip,
    });
    res.status(200).json({ data: denied });
  } catch (err) {
    next(err);
  }
};

/* GET /audit/resources/:resourceType/:resourceId/viewers */
export const getResourceViewers = async (req, res, next) => {
  try {
    if (!isAdmin(req.actor)) {
      throw new ForbiddenError(
        "resource viewers log",
        "admin or compliance_officer role required",
      );
    }

    const viewers = await auditService.getResourceViewers({
      resourceType: req.params.resourceType,
      resourceId: req.params.resourceId,
      from: req.query.from,
      to: req.query.to,
    });
    res.status(200).json({ data: viewers });
  } catch (err) {
    next(err);
  }
};

export default {
  getCaseHistory,
  getUserActivity,
  getDeniedAttempts,
  getResourceViewers,
};
