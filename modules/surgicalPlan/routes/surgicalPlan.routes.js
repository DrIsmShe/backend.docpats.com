// server/modules/surgicalPlan/routes/surgicalPlan.routes.js

import { Router } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";

import requireDoctorRole from "../../../common/middlewares/requireDoctorRole.js";
import * as controller from "../controllers/surgicalPlan.controller.js";
import validate from "../middleware/validate.js";
import parsePlanSchema, {
  validatePlanRequestSchema,
} from "../validators/parsePlan.validator.js";

/* ============================================================
   МАРШРУТЫ МОДУЛЯ
   ============================================================
   Монтируются в index.js под /api/surgical-plan.

   Только для врачей. Пациент не должен получать сгенерированное
   «после» самостоятельно ни при каких настройках: такая картинка
   читается как обещание результата, и между ней и пациентом
   обязан стоять человек, который отвечает за операцию.
   ============================================================ */

// Каждый разбор — платный вызов модели. Лимит по пользователю,
// а не по IP: в клинике врачи сидят за общим NAT, и IP-лимит
// наказывал бы весь кабинет за активность одного.
const parseLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === "test",
  // Гость сюда не доходит (requireDoctorRole выше), так что ветка с
  // IP — страховка. Адрес нормализуем через ipKeyGenerator: голый
  // req.ip даёт каждому адресу из /64 свой счётчик, и владелец
  // IPv6-подсети обходит лимит сменой последнего сегмента.
  keyGenerator: (req) =>
    req.session?.userId ? `u:${req.session.userId}` : ipKeyGenerator(req.ip),
  message: { error: "Слишком часто. Подождите минуту." },
});

const router = Router();

// Справочники — их читает интерфейс при открытии редактора.
router.get("/procedures", requireDoctorRole, controller.procedures);
router.get("/catalog/:procedureCode", requireDoctorRole, controller.catalog);

// Разбор промта.
router.post(
  "/parse",
  requireDoctorRole,
  parseLimiter,
  validate(parsePlanSchema, "body"),
  controller.parse,
);

// Пересчёт правленого плана. Отдельным лимитом не ограничен:
// модель здесь не вызывается, и это дешевле, чем любой GET со
// списком — а дёргается он на каждое движение ползунка.
router.post(
  "/validate",
  requireDoctorRole,
  validate(validatePlanRequestSchema, "body"),
  controller.validate,
);

export default router;
