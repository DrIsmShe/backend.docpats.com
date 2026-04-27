// server/modules/simulation/index.js
import simulationRouter from "./routes/simulation.routes.js";

/* ──────────────────────────────────────────────────────────────────────────
   Публичный API модуля — только router. Всё остальное (services, models,
   utils) приватное внутри модуля.

   Использование в server/index.js:
     import simulation from './modules/simulation/index.js';
     app.use('/api/simulation', simulation.router);

   Если модуль однажды будет вынесен в отдельный микросервис — этот файл
   останется единственной точкой интеграции.
   ────────────────────────────────────────────────────────────────────────── */
export default {
  router: simulationRouter,
  basePath: "/api/simulation",
};
