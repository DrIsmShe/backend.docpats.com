// modules/audit/index.js
//
// Точка входа модуля audit.
//
// Экспортирует то, что используется другими модулями:
//   - auditService     — для прямого вызова recordAction / queries
//   - auditMiddleware  — фабрика для авто-логирования на роутах
//   - extractActor     — middleware для подготовки req.actor / req.context
//   - auditRoutes      — REST endpoints для подключения в Express
//
// Использование в основном файле сервера (index.js / app.js):
//   import { auditRoutes } from "./modules/audit/index.js";
//   app.use("/audit", auditRoutes);
//
// Использование в других модулях:
//   import { auditMiddleware, auditService } from "../audit/index.js";

import auditService from "./services/audit.service.js";
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
  auditService,
  auditMiddleware,
  extractActor,
  auditRoutes,
  HIPAAAuditLog,
  ACTION_ENUM,
  RESOURCE_TYPE_ENUM,
  OUTCOME_ENUM,
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
