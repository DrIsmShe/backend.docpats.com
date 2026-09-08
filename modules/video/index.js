// server/modules/video/index.js
//
// Каталог видео DocPats — записи о фильмах, их права и связи с приёмами.
//
// Модуль ГЛОБАЛЬНЫЙ: ролики есть у клиники, у врача-одиночки и у пациента,
// поэтому tenantMiddleware здесь не обязателен. Ограничение по клинике
// делает сервис явным условием, а не плагин.
//
// Отношение к modules/videra: тот выдаёт пропуск в студию (кнопка «Снять
// фильм»), этот хранит то, что студия сняла. Разделение намеренное — студия
// живёт на другом сервере и своей базы пользователей не имеет.

import express from "express";
import { tenantMiddleware } from "../../common/middlewares/tenantMiddleware.js";
import videoRoutes from "./routes/video.routes.js";

const router = express.Router();

// tenantMiddleware с required: false.
//
// Без него req.tenantContext был бы пуст ВСЕГДА, и ролик, снятый врачом
// клиники, оказывался бы личным: clinicId не проставился бы, видимость
// "clinic" стала бы недостижимой, а права роли — неприменимыми. При этом
// требовать клинику нельзя: у пациента и врача-одиночки её нет, а витрина и
// вебхук студии приходят вообще без сессии. Ровно для этого у middleware и
// есть режим «нет сессии — идём дальше без контекста».
router.use(tenantMiddleware({ required: false }));
router.use("/", videoRoutes);

export default router;
