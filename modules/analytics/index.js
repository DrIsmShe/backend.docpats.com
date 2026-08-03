// modules/analytics/index.js
//
// Продуктовая аналитика посещаемости: сервер читает статистику из PostHog и
// отдаёт её админскому дашборду.
//
// ГРАНИЦА МОДУЛЯ. Здесь только ЧТЕНИЕ агрегатов. События пишет фронтенд
// напрямую в PostHog (client/src/lib/analytics.js), сервер в этом не
// участвует и никаких персональных данных не пересылает — наружу и внутрь
// ходят только шаблоны путей и счётчики.
//
// Не путать с двумя другими «аналитиками» проекта:
//   modules/audit/      — HIPAA-журнал доступа к данным пациентов;
//   modules/radiology/  — аналитика арены (успеваемость по кейсам).
// Этот модуль про продукт целиком: какими экранами пользуются.

import analyticsRoutes from "./routes/analytics.routes.js";

export { isAnalyticsConfigured } from "./analytics.config.js";
export { clearAnalyticsCache } from "./services/posthog.service.js";

export default analyticsRoutes;
