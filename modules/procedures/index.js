// server/modules/procedures/index.js
//
// Запись на операции и обследования — отдельный модуль, а не ветка внутри
// приёмов. Почему именно так, подробно расписано в модели:
// common/models/Procedure/procedureBooking.js.
//
// Монтирование:
//   server/index.js         app.use(routes)
//   common/routes/index.js  router.use("/procedures", proceduresModule)
//   ⇒  POST   /procedures
//      GET    /procedures?kind=&status=&from=&to=
//      GET    /procedures/day/:date
//      PATCH  /procedures/:id/status
//      POST   /procedures/:id/postpone
//      PATCH  /procedures/:id/archive
//
// Пациентских маршрутов здесь нет намеренно: операцию назначает врач, и
// самозапись на неё — не упущение, а решение.

import express from "express";
import procedureRoutes from "./routes/procedureRoutes.js";

const router = express.Router();
router.use("/", procedureRoutes);

export default router;
