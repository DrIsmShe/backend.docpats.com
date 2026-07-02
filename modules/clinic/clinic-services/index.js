// server/modules/clinic/clinic-services/index.js
//
// ВИТРИНА 2.0 (V4.2) — агрегатор подмодуля услуг клиники.
// Монтируется в clinic/index.js: router.use("/", clinicServiceRouter)
// → эндпоинты живут на /api/v1/clinic/services*.

import serviceRoutes from "./routes/service.routes.js";

export default serviceRoutes;
