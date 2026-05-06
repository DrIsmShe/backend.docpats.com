// modules/audit/middleware/auditMiddleware.js
//
// Express middleware-фабрика для автоматического логирования доступа к PHI.
//
// Использование:
//   import auditMiddleware from "../audit/middleware/auditMiddleware.js";
//
//   router.get("/dialog/:dialogId",
//     authMiddleware,
//     auditMiddleware({
//       resourceType: "chat-dialog",
//       action: "chat.dialog.read",
//       resourceIdFrom: "params.dialogId",
//     }),
//     handler,
//   );
//
// Что делает:
//   1. Подписывается на res.on("finish") — записывает в audit log
//      ПОСЛЕ того как handler ответил (чтобы знать success/statusCode)
//   2. Извлекает userId из req.user (или req.actor если есть)
//   3. Извлекает resourceId из указанного места (params/query/body)
//   4. Записывает success=true если статус 2xx-3xx, иначе denied/failure
//
// Ничего не блокирует — fire-and-forget через recordActionAsync.
// Никогда не падает — все try/catch.

import auditService from "../services/audit.service.js";

/* ═══════════ getValueByPath ═══════════
   Извлечь значение из объекта по dot-нотации.
   "params.dialogId" → req.params.dialogId
   "user._id"        → req.user._id
*/
function getValueByPath(obj, path) {
  if (!path || !obj) return null;
  return path.split(".").reduce((acc, key) => {
    if (acc === null || acc === undefined) return null;
    return acc[key];
  }, obj);
}

/* ═══════════ extractActorFromReq ═══════════
   Достать actor из req. Поддерживаем оба варианта:
   - req.actor (если уже был extractActor middleware)
   - req.user  (если extractActor не использовался)
*/
function extractActorFromReq(req) {
  if (req.actor?.userId) return req.actor;

  if (!req.user) return null;

  const userId =
    req.user._id?.toString?.() ||
    req.user.userId?.toString?.() ||
    req.userId?.toString?.();

  if (!userId) return null;

  // Email и role могут быть в req.user (из authMiddleware) или в req.session
  // (для DocPats — основной источник). Берём из обоих.
  const email = req.user.email || req.session?.email || null;
  const role = req.user.role || req.session?.role || null;

  return {
    userId,
    email,
    role,
  };
}

/* ═══════════ extractContextFromReq ═══════════ */
function extractContextFromReq(req, res) {
  if (req.context) {
    return {
      ...req.context,
      httpMethod: req.method,
      httpPath: req.originalUrl || req.url,
      statusCode: res.statusCode,
    };
  }

  return {
    ipAddress:
      req.ip ||
      req.headers?.["x-forwarded-for"]?.split(",")[0]?.trim() ||
      req.connection?.remoteAddress ||
      null,
    userAgent: req.headers?.["user-agent"] || null,
    sessionId: req.sessionID || null,
    requestId: req.id || null,
    httpMethod: req.method,
    httpPath: req.originalUrl || req.url,
    statusCode: res.statusCode,
  };
}

/* ═══════════ MIDDLEWARE FACTORY ═══════════
   Создать middleware для audit logging.

   @param {object} opts
   @param {string} opts.resourceType — chat-dialog/surgical-case/etc (required)
   @param {string} opts.action       — read/create/update/delete/etc (required)
   
   @param {string} [opts.resourceIdFrom]      — путь к ID ресурса в req
                                                 "params.dialogId" / "body.id"
                                                 Можно опустить для list-actions.
   
   @param {string} [opts.resourceOwnerIdFrom] — путь к userId владельца
                                                 "params.userId" / "body.patientId"
   
   @param {string} [opts.caseIdFrom]          — путь к caseId (для anthropometry)
   
   @param {function} [opts.skipIf]            — (req) => bool. Если true — не логируем.
                                                 Например, не логировать когда юзер
                                                 смотрит сам себя.
   
   @param {function} [opts.metaFrom]          — (req, res) => object. Доп. мета.

   @returns {function} Express middleware
*/
export default function auditMiddleware(opts) {
  if (!opts?.resourceType || !opts?.action) {
    throw new Error("auditMiddleware requires resourceType and action options");
  }

  return function auditMiddlewareInstance(req, res, next) {
    // Подписываемся на завершение ответа — логируем после того,
    // как handler закончил работу (чтобы знать success/statusCode).
    res.on("finish", () => {
      try {
        // Skip-условие
        if (opts.skipIf && opts.skipIf(req)) return;

        const actor = extractActorFromReq(req);
        if (!actor) {
          // Не аутентифицирован — нет смысла логировать как user-action.
          return;
        }

        // Извлекаем resourceId
        let resourceId = null;
        if (opts.resourceIdFrom) {
          const val = getValueByPath(req, opts.resourceIdFrom);
          resourceId = val ? String(val) : null;
        }

        // Извлекаем resourceOwnerId
        let resourceOwnerId = null;
        if (opts.resourceOwnerIdFrom) {
          const val = getValueByPath(req, opts.resourceOwnerIdFrom);
          resourceOwnerId = val ? String(val) : null;
        }

        // Извлекаем caseId (для anthropometry)
        let caseId = null;
        if (opts.caseIdFrom) {
          const val = getValueByPath(req, opts.caseIdFrom);
          caseId = val ? String(val) : null;
        }

        // Метаданные
        let metadata = null;
        if (opts.metaFrom) {
          try {
            metadata = opts.metaFrom(req, res) || null;
          } catch (err) {
            console.warn("[audit] metaFrom error:", err.message);
          }
        }

        // Определяем outcome по статусу:
        //   2xx-3xx → success
        //   401, 403, 404 → denied (доступ запрещён или ресурс закрыт)
        //   4xx (остальные) → failure (валидация, неверный формат)
        //   5xx → failure (серверная ошибка)
        const status = res.statusCode;
        let outcome = "success";
        if (status === 401 || status === 403 || status === 404) {
          outcome = "denied";
        } else if (status >= 400) {
          outcome = "failure";
        }

        const context = extractContextFromReq(req, res);

        auditService.recordActionAsync({
          actor,
          action: opts.action,
          resourceType: opts.resourceType,
          resourceId,
          resourceOwnerId,
          caseId,
          outcome,
          metadata,
          context,
        });
      } catch (err) {
        // Никогда не дать middleware упасть.
        console.warn("[auditMiddleware] error:", err.message);
      }
    });

    next();
  };
}

export { auditMiddleware };
