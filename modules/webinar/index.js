// server/modules/webinar/index.js

/* ============================================================
   WEBINAR — ПУБЛИЧНОЕ API МОДУЛЯ
   ============================================================
   Третий способ собрать людей в видеосвязи, рядом с двумя
   существующими, и границы между ними намеренно резкие:

   звонок     — дозвон, один на один или консилиум на несколько
                человек. Комната эфемерная, живёт в памяти.
   групповой  — постоянная комната при переписке. Люди уже
   диалог       связаны чатом, встреча — побочный эффект.
   вебинар    — встреча по ссылке. Ни дозвона, ни переписки:
                адрес, время, ведущий и правила входа.

   Настоящий предел числа участников задаёт не этот модуль,
   а видеомост: MAX_PARTICIPANTS и channelLastN в конфигурации
   Jitsi. Отсюда приходит только право войти.
   ============================================================ */

import Webinar from "./models/Webinar.model.js";
import routes from "./routes/webinar.routes.js";
import * as service from "./services/webinar.service.js";

export const basePath = "/api/webinars";

export { Webinar, routes, service };

export const WEBINAR_MODULE_VERSION = "0.1.0";

export default {
  basePath,
  routes,
  Webinar,
  service,
  version: WEBINAR_MODULE_VERSION,
};
