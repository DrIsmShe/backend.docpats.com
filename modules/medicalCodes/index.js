// server/modules/medicalCodes/index.js
//
// Справочник медицинских кодов: болезни (МКБ-10) и вмешательства (ICHI).
//
// Монтируется в главном index.js как
//   app.use("/api/v1/medical-codes", medicalCodesRoutes)
// ПОСЛЕ session-middleware: доступ определяется ролью из req.session.
//
// Модуль глобальный, без tenantMiddleware — справочник кодов одинаков для всех
// клиник и не содержит данных пациентов. Устроен по образцу radiology и
// diagnostics: своя точка авторизации, потому что common/auth/can.js завязан
// на ClinicMembership.
//
// Зачем модуль вообще, если автокомплит МКБ в проекте уже был: тот ходил из
// браузера врача в публичный API NLM — только по-английски и только при живой
// связи с США. Здесь справочник лежит в своей базе: работает офлайн, отвечает
// за миллисекунды, и в него можно положить переводы на языки системы.

import express from "express";
import codesRouter from "./routes/codes.routes.js";
import { requireMedicalStaff } from "./middlewares/codesAuth.js";

const router = express.Router();

// Health — до авторизации, нужен мониторингу.
router.get("/health", (req, res) => {
  res.json({
    ok: true,
    module: "medicalCodes",
    timestamp: new Date().toISOString(),
  });
});

router.use(requireMedicalStaff);
router.use("/", codesRouter);

export default router;
