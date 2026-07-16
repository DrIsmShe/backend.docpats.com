// common/middlewares/requireClinicPerm.js
//
// Роут-middleware проверки прав для clinic-домена поверх нового can.js.
// Роль берётся из AsyncLocalStorage-контекста (tenantMiddleware ставит его
// раньше по цепочке), поэтому работает и для User-owner, и для session.employeeId.
//
// Использование в роутах:
//   import { requireClinicPerm } from "../../../../common/middlewares/requireClinicPerm.js";
//   router.post("/rooms", requireClinicPerm("room", "write"), controller.create);
//   router.delete("/rooms/:id", requireClinicPerm("room", "delete"), controller.remove);
//
// ВАЖНО: вешать ПОСЛЕ tenantMiddleware (в clinic/index.js он применён ко всем
// субмодулям), иначе роли в контексте ещё нет и проверка всегда откажет.

import { require as requireCan } from "../auth/can.js";

/**
 * @param {string} resource  ресурс из permissions.js RESOURCES (напр. "room")
 * @param {string} action    "read" | "write" | "delete"
 */
export function requireClinicPerm(resource, action) {
  return (req, res, next) => {
    try {
      requireCan(resource, action); // бросит ForbiddenError, если нельзя
      next();
    } catch (err) {
      next(err);
    }
  };
}
