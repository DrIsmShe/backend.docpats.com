// server/modules/ebm/index.js
//
// Доказательная медицина: врач спрашивает — система показывает, что по этому
// вопросу есть в PubMed, разложенное по силе дизайна исследования.
//
// Монтируется в главном index.js как
//   app.use("/api/v1/ebm", ebmRoutes)
// ПОСЛЕ session-middleware: доступ определяется ролью из req.session.
//
// Модуль глобальный, без tenantMiddleware: PubMed одинаков для всех клиник, и
// данных пациентов здесь нет вовсе — ни в запросе, ни в ответе. Своя точка
// авторизации, потому что common/auth/can.js завязан на ClinicMembership.
//
// ГЛАВНОЕ ПРО ЭТОТ МОДУЛЬ: модель к поиску не допускается.
//
// Названия работ, журналы, годы, PMID и DOI приходят из PubMed и только из
// PubMed. Это не осторожность вообще, а вывод из замера на своих же данных:
// из 80 ссылок, написанных моделью по памяти, 14 указывали на несуществующие
// работы, а 20 — на чужие. Для статьи это стыдно; здесь врач может назначить
// препарат. Место модели — позже и отдельно: пересказать НАЙДЕННОЕ. Первый
// этап работает без неё вовсе и проверяется целиком.

import express from "express";
import ebmRouter from "./routes/ebm.routes.js";
import { requireMedicalStaff } from "./middlewares/ebmAuth.js";

const router = express.Router();

// Health — до авторизации, нужен мониторингу.
router.get("/health", (req, res) => {
  res.json({
    ok: true,
    module: "ebm",
    timestamp: new Date().toISOString(),
  });
});

router.use(requireMedicalStaff);
router.use("/", ebmRouter);

export default router;
