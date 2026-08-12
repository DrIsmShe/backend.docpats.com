// modules/admin/routes/adminRoute.js
//
// Перенос данных администратором: выгрузка и загрузка базы целиком или
// отдельными коллекциями. Смонтирован как /api/admin (common/routes/uploadFileRoutes.js).
//
// ПОЧЕМУ POST, А НЕ GET, ДАЖЕ НА СКАЧИВАНИЕ. Выгрузка требует подтверждения
// паролем, а пароль в строке запроса оседает в журналах nginx, в истории
// браузера и в заголовке Referer. Тело POST-запроса туда не попадает.
// Побочно это защищает и от того, чтобы выгрузку базы можно было запустить
// одной ссылкой, открытой в чужой вкладке.
//
// Прежние маршруты (GET /export-all, GET /export/:collection, POST /import-all,
// POST /import-collection) УДАЛЕНЫ, а не оставлены рядом: они не требовали
// пароля, не писали в аудит, собирали дамп целиком в памяти и позволяли
// записать что угодно в любую коллекцию. Пока они существуют, все новые
// проверки обходятся простым обращением по старому адресу.

import { Router } from "express";
import multer from "multer";

import requireAdmin from "../middlewares/authvalidateMiddleware/requireAdmin.js";
import {
  listDatabases,
  listCollections,
  exportDatabase,
  exportCollection,
  importDatabase,
  importCollection,
} from "../controllers/adminDataTransfer.controller.js";

// Файл дампа читается в память целиком — иначе его не разобрать. Предел в
// 512 МБ нужен, чтобы случайно выбранный чужой файл не съел память процесса,
// обслуживающего врачей. Полная база сейчас ~170 МБ, запас есть.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 512 * 1024 * 1024 },
});

const router = Router();

router.get("/transfer/databases", requireAdmin, listDatabases);
router.get("/transfer/collections", requireAdmin, listCollections);

router.post("/transfer/export-database", requireAdmin, exportDatabase);
router.post("/transfer/export-collection", requireAdmin, exportCollection);

router.post(
  "/transfer/import-database",
  requireAdmin,
  upload.single("file"),
  importDatabase,
);
router.post(
  "/transfer/import-collection",
  requireAdmin,
  upload.single("file"),
  importCollection,
);

export default router;
