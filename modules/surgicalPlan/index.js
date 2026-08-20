// server/modules/surgicalPlan/index.js

/* ============================================================
   SURGICAL PLAN — ПУБЛИЧНЫЙ API МОДУЛЯ
   ============================================================
   Прослойка между антропометрией (что измерено) и симуляцией
   (что рисуем). Отвечает на один вопрос: что именно врач просит
   сделать — в операциях каталога, миллиметрах и градусах.

   Границы модуля:
   - НЕ рисует и не морфит — это simulation/surgery;
   - НЕ измеряет фото — это anthropometry;
   - НЕ хранит планы — прототип ничего не пишет в базу.

   Языковая модель участвует ровно в одной функции (parsePrompt).
   Всё остальное — детерминированный код, и это главное свойство
   модуля: план воспроизводим и объясним построчно.
   ============================================================ */

import { getCatalog, PROCEDURE_CODES } from "./catalog/index.js";
import routes from "./routes/surgicalPlan.routes.js";
import { parsePrompt } from "./services/planParser.service.js";
import { buildPlanSchema } from "./services/planSchema.service.js";
import { validatePlan } from "./services/planValidator.service.js";

export const basePath = "/api/surgical-plan";

export { routes, getCatalog, PROCEDURE_CODES, parsePrompt, validatePlan, buildPlanSchema };

export const SURGICAL_PLAN_MODULE_VERSION = "0.1.0-prototype";

export default {
  basePath,
  routes,
  getCatalog,
  PROCEDURE_CODES,
  parsePrompt,
  validatePlan,
  buildPlanSchema,
  version: SURGICAL_PLAN_MODULE_VERSION,
};
