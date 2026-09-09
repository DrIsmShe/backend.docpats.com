// server/modules/feedback/index.js
//
// Обратная связь: пожелания, замечания и найденные ошибки — от врачей,
// пациентов и клиник напрямую разработчикам.
//
// МОДУЛЬ ГЛОБАЛЬНЫЙ. Обращение пишет человек, а не клиника: пациент к ней
// не привязан вовсе, а врач может работать в двух. Поэтому tenantScoped
// здесь не применяется, а клиника пишется в документ справочно — чтобы
// разбор видел, откуда пришло, и только.
//
// tenantMiddleware подключён в режиме «не обязательно»: без него у
// сотрудника клиники не определилась бы роль, а у пациента запрос падал бы
// на отсутствии членства.

import express from "express";
import { tenantMiddleware } from "../../common/middlewares/tenantMiddleware.js";
import feedbackRoutes from "./routes/feedback.routes.js";

const router = express.Router();

router.use(tenantMiddleware({ required: false }));
router.use("/", feedbackRoutes);

export default router;
