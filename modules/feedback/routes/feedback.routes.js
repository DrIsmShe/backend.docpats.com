// server/modules/feedback/routes/feedback.routes.js
//
// Маршруты обратной связи. Монтируются как app.use("/api/v1/feedback", ...)
// ПОСЛЕ session-middleware: без входа обращение принять нельзя — иначе
// очередь разбора за неделю превратится в спам-ящик.
//
// ПОРЯДОК ОБЪЯВЛЕНИЯ. Административные пути объявлены до "/:id", иначе
// "/admin" был бы прочитан как идентификатор обращения.
//
// ПОЧЕМУ АДМИНСКАЯ ЧАСТЬ ЗДЕСЬ, А НЕ В modules/admin. Разбор — это вторая
// половина одного разговора: те же документы, те же правила, те же тексты
// автоответов. Разнеся половины по модулям, мы получили бы два места, где
// надо помнить про закрытие с итогом.

import express from "express";
import { requireSession } from "../../../common/middlewares/requireSession.js";
import requireAdmin from "../../admin/middlewares/authvalidateMiddleware/requireAdmin.js";
import * as ctrl from "../controllers/feedback.controller.js";

const router = express.Router();

router.use(requireSession);

/* ── Разбор: только администраторы проекта ──────────────────────── */
router.get("/admin/queue", requireAdmin, ctrl.queueController);
router.get("/admin/templates", requireAdmin, ctrl.templatesController);
router.get("/admin/:id", requireAdmin, ctrl.cardController);
router.post("/admin/:id/reply", requireAdmin, ctrl.adminReplyController);
router.patch("/admin/:id/status", requireAdmin, ctrl.statusController);

/* ── Автор ──────────────────────────────────────────────────────── */
router.get("/dictionary", ctrl.dictionaryController);
router.get("/", ctrl.myListController);
router.post("/", ctrl.createController);
router.get("/:id", ctrl.myOneController);
router.post("/:id/reply", ctrl.replyController);

export default router;
