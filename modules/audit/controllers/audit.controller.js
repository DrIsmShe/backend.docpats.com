// modules/audit/controllers/audit.controller.js
//
// REST controllers для compliance-эндпоинтов.
//
// Доступ только для admin / compliance_officer ролей.
// Юзер может посмотреть только свою активность (если не admin).

import auditService from "../services/audit.service.js";
import { ForbiddenError } from "../utils/errors.js";

/* ═══════════ Helper — проверка админских прав ═══════════ */
const isAdmin = (actor) => {
  if (!actor) return false;
  return actor.role === "admin" || actor.role === "compliance_officer";
};

/* ═══════════ GET /audit/users/:userId ═══════════
   История действий пользователя за период.
   Юзер может смотреть только свою активность.
   Admin / compliance_officer — любую. */
export const getUserActivity = async (req, res, next) => {
  try {
    const targetUserId = req.params.userId;
    const isOwnActivity = String(targetUserId) === String(req.actor.userId);

    if (!isOwnActivity && !isAdmin(req.actor)) {
      throw new ForbiddenError(
        "user activity",
        "you can only view your own activity",
      );
    }

    const opts = {
      action: req.query.action || undefined,
      from: req.query.from ? new Date(req.query.from) : undefined,
      to: req.query.to ? new Date(req.query.to) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : 100,
      skip: req.query.skip ? Number(req.query.skip) : 0,
    };

    const activity = await auditService.getUserActivity(targetUserId, opts);
    res.status(200).json({ data: activity });
  } catch (err) {
    next(err);
  }
};

/* ═══════════ GET /audit/cases/:caseId ═══════════
   История действий по случаю (для anthropometry).
   Только admin. */
export const getCaseHistory = async (req, res, next) => {
  try {
    if (!isAdmin(req.actor)) {
      throw new ForbiddenError(
        "case audit history",
        "admin or compliance_officer role required",
      );
    }

    const opts = {
      action: req.query.action || undefined,
      limit: req.query.limit ? Number(req.query.limit) : 100,
      skip: req.query.skip ? Number(req.query.skip) : 0,
    };

    const history = await auditService.getCaseHistory(req.params.caseId, opts);
    res.status(200).json({ data: history });
  } catch (err) {
    next(err);
  }
};

/* ═══════════ GET /audit/resources/:resourceType/:resourceId ═══════════
   Все действия с конкретным ресурсом.
   Admin или владелец ресурса. */
export const getResourceHistory = async (req, res, next) => {
  try {
    const { resourceType, resourceId } = req.params;

    // Простая проверка прав. Полная проверка владения — TODO для будущего.
    // Сейчас только admin может смотреть историю любого ресурса.
    if (!isAdmin(req.actor)) {
      throw new ForbiddenError(
        "resource audit history",
        "admin or compliance_officer role required",
      );
    }

    const opts = {
      action: req.query.action || undefined,
      limit: req.query.limit ? Number(req.query.limit) : 100,
    };

    const history = await auditService.getResourceHistory(
      resourceType,
      resourceId,
      opts,
    );
    res.status(200).json({ data: history });
  } catch (err) {
    next(err);
  }
};

/* ═══════════ GET /audit/owners/:ownerId ═══════════
   Право пациента по HIPAA: "покажите кто видел мои данные".
   Юзер может смотреть только свои данные. Admin — любые. */
export const getOwnerHistory = async (req, res, next) => {
  try {
    const ownerId = req.params.ownerId;
    const isOwnData = String(ownerId) === String(req.actor.userId);

    if (!isOwnData && !isAdmin(req.actor)) {
      throw new ForbiddenError(
        "owner audit history",
        "you can only view who accessed your own data",
      );
    }

    const opts = {
      from: req.query.from ? new Date(req.query.from) : undefined,
      to: req.query.to ? new Date(req.query.to) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : 100,
    };

    const history = await auditService.getOwnerHistory(ownerId, opts);
    res.status(200).json({ data: history });
  } catch (err) {
    next(err);
  }
};

/* ═══════════ GET /audit/denied ═══════════
   Отказы доступа за период. Только admin. */
export const getDeniedAttempts = async (req, res, next) => {
  try {
    if (!isAdmin(req.actor)) {
      throw new ForbiddenError(
        "denied attempts log",
        "admin or compliance_officer role required",
      );
    }

    const opts = {
      from: req.query.from ? new Date(req.query.from) : undefined,
      userId: req.query.userId || undefined,
      limit: req.query.limit ? Number(req.query.limit) : 200,
    };

    const denied = await auditService.getDeniedAttempts(opts);
    res.status(200).json({ data: denied });
  } catch (err) {
    next(err);
  }
};

/* ═══════════ GET /audit/resources/:resourceType/:resourceId/viewers ═══════════
   Кто смотрел конкретный ресурс. Admin. */
export const getResourceViewers = async (req, res, next) => {
  try {
    if (!isAdmin(req.actor)) {
      throw new ForbiddenError(
        "resource viewers log",
        "admin or compliance_officer role required",
      );
    }

    const opts = {
      limit: req.query.limit ? Number(req.query.limit) : 100,
    };

    const viewers = await auditService.getResourceViewers(
      req.params.resourceType,
      req.params.resourceId,
      opts,
    );
    res.status(200).json({ data: viewers });
  } catch (err) {
    next(err);
  }
};

export default {
  getUserActivity,
  getCaseHistory,
  getResourceHistory,
  getOwnerHistory,
  getDeniedAttempts,
  getResourceViewers,
};
