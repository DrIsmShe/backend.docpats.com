// server/modules/diagnostics/index.js
//
// МОДУЛЬ ДИАГНОСТИЧЕСКОЙ ПОМОЩИ. Монтируется в главном index.js как
// app.use("/api/v1/diagnostics", diagnosticsRoutes) — ПОСЛЕ session-middleware.
//
// Устройство: ядро (core/) + подмодуль на каждый вид обследования. Подмодули
// регистрируются в реестре при импорте — как reading-systems в radiology.
// Добавить модальность = добавить папку и импорт ниже.
//
// ВАЖНО про границы: этот модуль работает с данными ЖИВЫХ пациентов, в отличие
// от учебной арены (modules/radiology). Поэтому у них РАЗНЫЕ коллекции, разные
// права и разный юридический статус, хотя приёмы построения общие. Смешивать
// их нельзя: учебные кейсы не должны оказаться в контуре с PHI, а клинические
// материалы — в тренажёре.

import express from "express";
import multer from "multer";

import { requireClinician } from "./middlewares/diagnosticsAuth.js";
import { ALLOWED_MIME, MAX_FILE_BYTES } from "./ai/documentReader.js";
import * as ctrl from "./core/controllers/diagnostics.controller.js";
import {
  errorHandler,
  notFoundHandler,
} from "../../common/middlewares/errorHandler.js";

// Регистрация подмодулей. Порядок импорта не важен — реестр сортирует сам,
// но папка на модальность обязательна: так видно, что модуль умеет.
import "./clinical/clinical.modality.js";
import "./labs/labs.modality.js";
import "./xray/xray.modality.js";
import "./ct/ct.modality.js";
import "./mri/mri.modality.js";
import "./us/us.modality.js";
import "./ecg/ecg.modality.js";
import "./endoscopy/endoscopy.modality.js";
import "./histology/histology.modality.js";
import "./derm/derm.modality.js";

const router = express.Router();

// Health — до авторизации, нужен мониторингу.
router.get("/health", (req, res) => {
  res.json({ ok: true, module: "diagnostics", timestamp: new Date().toISOString() });
});

// Дальше — только врачи. req.diagnosticsActor гарантированно есть.
router.use(requireClinician);

// Справочник модальностей: что умеет каждый подмодуль и по какому протоколу
// разбирает. Врач должен видеть протокол ДО того, как отправит материал.
router.get("/modalities", ctrl.listModalitiesController);

// Показатели, которые модуль узнаёт по ключу: по ним работают пороги
// критических значений и связки. Форма ввода панели строится из этого списка.
router.get("/labs/analytes", ctrl.listAnalytesController);

// Дела.
router.post("/cases", ctrl.createCaseController);
router.get("/cases", ctrl.listCasesController);
router.get("/cases/:id", ctrl.getCaseController);
router.patch("/cases/:id", ctrl.updateCaseController);
router.post("/cases/:id/close", ctrl.closeCaseController);
router.post("/cases/:id/reopen", ctrl.reopenCaseController);

// Распознавание документа: фото бланка или PDF → текст.
//
// memoryStorage, а не диск: файл не должен пережить запрос. Он не пишется ни
// на диск, ни в R2 — в дело попадает только текст, и только после проверки
// врачом. Хранилища, которого нет, не существует и для утечки.
//
// Предел размера дублирует проверку в documentReader намеренно: multer
// отказывает до того, как файл целиком окажется в памяти процесса, а
// documentReader — до того, как он уйдёт в модель. Это разные рубежи.
const documentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIME.includes(file.mimetype)) return cb(null, true);
    cb(new Error(`Формат ${file.mimetype} не поддерживается`));
  },
});

router.post("/cases/:id/extract", documentUpload.single("file"), ctrl.extractDocumentController);

// Материалы дела.
router.post("/cases/:id/artifacts", ctrl.addArtifactController);
router.delete("/cases/:id/artifacts/:artifactId", ctrl.removeArtifactController);

// Разбор.
router.post("/cases/:id/analyze", ctrl.analyzeController);
router.post("/jobs/:jobId/rerun", ctrl.rerunJobController);

// Обратная связь врача по выводу — она же разметка будущего датасета.
router.post("/findings/:findingId/verdict", ctrl.verdictController);
router.get("/stats", ctrl.statsController);

router.use(notFoundHandler);
router.use(errorHandler);

export default router;
