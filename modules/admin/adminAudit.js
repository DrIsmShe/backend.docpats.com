// modules/admin/adminAudit.js
//
// Хелпер HIPAA-аудита для admin-действий. Доступ платформенного админа к PHI
// (медданным/ПДн пациентов) обязан логироваться (§164.312(b)) — раньше
// admin-контроллеры не писали в аудит вообще.

import { recordActionAsync } from "../audit/index.js";

/**
 * @param {object} req
 * @param {object} opts
 * @param {string} opts.action        — read | list | update | delete
 * @param {string} opts.resourceType  — из RESOURCE_TYPE_ENUM (напр. "patient-profile")
 * @param {string} [opts.resourceId]
 * @param {string} [opts.resourceOwnerId]
 * @param {object} [opts.metadata]    — только структурные данные, без PHI
 */
export function auditAdminAccess(
  req,
  { action, resourceType, resourceId = null, resourceOwnerId = null, metadata = {} },
) {
  recordActionAsync({
    actor: { userId: req.userId || req.session?.userId, role: "admin" },
    action,
    resourceType,
    resourceId,
    resourceOwnerId,
    outcome: "success",
    context: {
      ipAddress: req.ip,
      userAgent: req.get("user-agent"),
      sessionId: req.sessionID,
    },
    metadata,
  });
}
