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

import os from "node:os";
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
import {
  listDoctors,
  listSpecializations,
  getDoctor,
  createDoctor,
  updateDoctor,
  deleteDoctor,
} from "../controllers/adminDoctors.controller.js";

// Файл дампа кладётся на ДИСК, а не в память. Причина измеренная: дамп базы
// новостей весит 1081 МБ (17 000 документов по 33 КБ — полные тексты статей).
// В памяти это гигабайтный буфер в процессе, который обслуживает врачей, а
// строка такой длины в V8 к тому же невозможна — предел около 512 МБ.
// Читается файл потоком, построчно (см. controllers/dumpReader.js).
//
// Предел в 4 ГБ — от случайно выбранного чужого файла, а не от наших дампов:
// самый большой сейчас в четыре раза меньше.
const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: 4 * 1024 * 1024 * 1024 },
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

// ── Профили врачей ──
//
// Справочник специальностей идёт ПЕРЕД /doctors/:userId — иначе Express
// примет слово "specializations" за идентификатор и уйдёт искать врача с
// таким _id, свалившись на приведении к ObjectId.
router.get("/doctors", requireAdmin, listDoctors);
router.get("/doctors/specializations", requireAdmin, listSpecializations);
router.get("/doctors/:userId", requireAdmin, getDoctor);
router.post("/doctors", requireAdmin, createDoctor);
router.put("/doctors/:userId", requireAdmin, updateDoctor);
router.delete("/doctors/:userId", requireAdmin, deleteDoctor);

export default router;
