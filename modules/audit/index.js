// modules/audit/index.js
//
// Точка входа модуля audit.
//
// Экспортирует то, что используется другими модулями:
//   - auditService     — для прямого вызова recordAction / queries
//   - auditMiddleware  — фабрика для авто-логирования на роутах
//   - extractActor     — middleware для подготовки req.actor / req.context
//   - auditRoutes      — REST endpoints для подключения в Express
//   - recordAction*    — прямые функции для вызова из WebSocket handlers
//
// Использование в основном файле сервера (index.js / app.js):
//   import { auditRoutes } from "./modules/audit/index.js";
//   app.use("/audit", auditRoutes);
//
// Использование в Express middleware:
//   import { auditMiddleware } from "../audit/index.js";
//   router.get("/", authMiddleware, auditMiddleware({...}), handler);
//
// Использование в WebSocket / прямой вызов:
//   import { recordActionAsync } from "../audit/index.js";
//   recordActionAsync({ userId, action, resourceType, outcome, ... });

import auditService, {
  recordAction,
  recordActionAsync,
  recordDeniedAccess,
  getUserActivity,
  getCaseHistory,
  getResourceHistory,
  getOwnerHistory,
  getDeniedAttempts,
  getResourceViewers,
} from "./services/audit.service.js";
import auditMiddleware from "./middleware/auditMiddleware.js";
import extractActor from "./middleware/extractActor.js";
import auditRoutes from "./routes/audit.routes.js";
import HIPAAAuditLog from "./models/AuditLog.model.js";
import {
  ACTION_ENUM,
  RESOURCE_TYPE_ENUM,
  OUTCOME_ENUM,
} from "./enums/auditEnums.js";

export {
  // ── Service objects ───────────────────────────────────────
  auditService,
  auditMiddleware,
  extractActor,
  auditRoutes,
  HIPAAAuditLog,
  // ── Enums ─────────────────────────────────────────────────
  ACTION_ENUM,
  RESOURCE_TYPE_ENUM,
  OUTCOME_ENUM,
  // ── Direct function re-exports (avoid auditService.fn syntax) ──
  recordAction,
  recordActionAsync,
  recordDeniedAccess,
  getUserActivity,
  getCaseHistory,
  getResourceHistory,
  getOwnerHistory,
  getDeniedAttempts,
  getResourceViewers,
};

// Default export — для удобства
export default {
  service: auditService,
  middleware: auditMiddleware,
  extractActor,
  routes: auditRoutes,
  Model: HIPAAAuditLog,
  enums: {
    ACTION_ENUM,
    RESOURCE_TYPE_ENUM,
    OUTCOME_ENUM,
  },
};
