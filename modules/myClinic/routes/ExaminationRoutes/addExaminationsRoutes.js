import { Router } from "express";
import addCTscanController from "../../controllers/CTscanControllers/addCTscanController.js";
import addMRIscanController from "../../controllers/MRIscanControllers/addMRIscanController.js";
import addUSMscanController from "../../controllers/USMscanController/addUSMscanController.js";
import addXRAYscanController from "../../controllers/XRAYscanControllers/addXRAYscanController.js";
import addPETscanController from "../../controllers/PETscanControllers/addPETscanController.js";
import addSPECTscanController from "../../controllers/SPECTscanControllers/addSPECTscanController.js";
import addEEGscanController from "../../controllers/EEGscanControllers/addEEGscanController.js";
import addGinecologyscanController from "../../controllers/GinecologyscanController/addGinecologyscanController.js";
import addHOLTERscanController from "../../controllers/HOLTERscanController/addHOLTERscanController.js";
import addSpirometryscanController from "../../controllers/SpirometryscanControllers/addSpirometryscanController.js";
import addDoplerscanController from "../../controllers/DoplerscanController/addDoplerscanController.js";

import addGastroscopyscanController from "../../controllers/GastroscopyscanControllers/addGastroscopyscanController.js";
import addCapsuleEndoscopyscanController from "../../controllers/CapsuleEndoscopyscanControllers/addCapsuleEndoscopyscanController.js";
import addAngiographyscanController from "../../controllers/AngiographyscanController/addAngiographyscanController.js";
import addAEKGscanController from "../../controllers/EKGscanController/addEKGscanController.js";
import addEchoEKGscanController from "../../controllers/EchoEKGscanController/addEchoEKGscanController.js";

import addCoronographyscanController from "../../controllers/CoronographyscanController/addCoronographyscanController.js";
import addLabtestscanController from "../../controllers/LabtestscanController/addLabtestscanController.js";

import {
  upload,
  processFiles,
} from "../../../../common/middlewares/uploadMiddleware.js";

const router = Router();

/**
 * 📌 Маршрут для добавления КТ-скана
 * `patientId` передается в URL
 * `files` передаются в `FormData`
 */
router.post(
  "/add-ct-scan/:patientId",
  upload.array("files", 10), // 🔥 Разрешаем загрузку до 10 файлов
  processFiles, // 🔥 Обрабатываем файлы перед передачей в контроллер
  addCTscanController
);

router.post(
  "/add-mri-scan/:patientId",
  upload.array("files", 10), // 🔥 Разрешаем загрузку до 10 файлов
  processFiles, // 🔥 Обрабатываем файлы перед передачей в контроллер
  addMRIscanController
);
router.post(
  "/add-usm-scan/:patientId",
  upload.array("files", 10), // 🔥 Разрешаем загрузку до 10 файлов
  processFiles, // 🔥 Обрабатываем файлы перед передачей в контроллер
  addUSMscanController
);
router.post(
  "/add-xray-scan/:patientId",
  upload.array("files", 10), // 🔥 Разрешаем загрузку до 10 файлов
  processFiles, // 🔥 Обрабатываем файлы перед передачей в контроллер
  addXRAYscanController
);
router.post(
  "/add-pet-scan/:patientId",
  upload.array("files", 10), // 🔥 Разрешаем загрузку до 10 файлов
  processFiles, // 🔥 Обрабатываем файлы перед передачей в контроллер
  addPETscanController
);

router.post(
  "/add-spect-scan/:patientId",
  upload.array("files", 10), // 🔥 Разрешаем загрузку до 10 файлов
  processFiles, // 🔥 Обрабатываем файлы перед передачей в контроллер
  addSPECTscanController
);

router.post(
  "/add-eeg-scan/:patientId",
  upload.array("files", 10), // 🔥 Разрешаем загрузку до 10 файлов
  processFiles, // 🔥 Обрабатываем файлы перед передачей в контроллер
  addEEGscanController
);

router.post(
  "/add-ginecology-test/:patientId",
  upload.array("files", 10), // 🔥 Разрешаем загрузку до 10 файлов
  processFiles, // 🔥 Обрабатываем файлы перед передачей в контроллер
  addGinecologyscanController
);

router.post(
  "/add-holter-scan/:patientId",
  upload.array("files", 10), // 🔥 Разрешаем загрузку до 10 файлов
  processFiles, // 🔥 Обрабатываем файлы перед передачей в контроллер
  addHOLTERscanController
);

router.post(
  "/add-spirometry-scan/:patientId",
  upload.array("files", 10), // 🔥 Разрешаем загрузку до 10 файлов
  processFiles, // 🔥 Обрабатываем файлы перед передачей в контроллер
  addSpirometryscanController
);
router.post(
  "/add-dopler-scan/:patientId",
  upload.array("files", 10), // 🔥 Разрешаем загрузку до 10 файлов
  processFiles, // 🔥 Обрабатываем файлы перед передачей в контроллер
  addDoplerscanController
);

router.post(
  "/add-gastroscopy-scan/:patientId",
  upload.array("files", 10), // 🔥 Разрешаем загрузку до 10 файлов
  processFiles, // 🔥 Обрабатываем файлы перед передачей в контроллер
  addGastroscopyscanController
);
router.post(
  "/add-CapsuleEndoscopy-scan/:patientId",
  upload.array("files", 10), // 🔥 Разрешаем загрузку до 10 файлов
  processFiles, // 🔥 Обрабатываем файлы перед передачей в контроллер
  addCapsuleEndoscopyscanController
);
router.post(
  "/add-Angiography-scan/:patientId",
  upload.array("files", 10), // 🔥 Разрешаем загрузку до 10 файлов
  processFiles, // 🔥 Обрабатываем файлы перед передачей в контроллер
  addAngiographyscanController
);
router.post(
  "/add-ekg-scan/:patientId",
  upload.array("files", 10), // 🔥 Разрешаем загрузку до 10 файлов
  processFiles, // 🔥 Обрабатываем файлы перед передачей в контроллер
  addAEKGscanController
);
router.post(
  "/add-echo-ekg-scan/:patientId",
  upload.array("files", 10), // 🔥 Разрешаем загрузку до 10 файлов
  processFiles, // 🔥 Обрабатываем файлы перед передачей в контроллер
  addEchoEKGscanController
);

router.post(
  "/add-coronography-scan/:patientId",
  upload.array("files", 10), // 🔥 Разрешаем загрузку до 10 файлов
  processFiles, // 🔥 Обрабатываем файлы перед передачей в контроллер
  addCoronographyscanController
);
router.post(
  "/add-labtest-scan/:patientId",
  upload.array("files", 10), // 🔥 Разрешаем загрузку до 10 файлов
  processFiles, // 🔥 Обрабатываем файлы перед передачей в контроллер
  addLabtestscanController
);
export default router;
