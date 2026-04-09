import { Router } from "express";

/* ===================== AUTH & PATIENT RESOLVER ===================== */
import authMiddleware from "../../../../common/middlewares/authMiddleware.js";
import resolvePatient from "../../../../common/middlewares/resolvePatient.js";

/* ===================== CONTROLLERS ===================== */
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

/* ===================== FILE UPLOAD ===================== */
import {
  upload,
  processFiles,
} from "../../../../common/middlewares/uploadMiddleware.js";

/* ===================== ROUTER ===================== */
const router = Router();

/**
 * 🔐 ОБЩИЙ НАБОР MIDDLEWARE
 * 1️⃣ authMiddleware – кто
 * 2️⃣ resolvePatient – кому (registered / private)
 * 3️⃣ upload + processFiles – что загрузили
 */
const baseMiddlewares = [
  authMiddleware,
  resolvePatient,
  upload.array("files", 10),
  processFiles,
];

/* ===================== ROUTES ===================== */

router.post("/add-ct-scan/:patientId", ...baseMiddlewares, addCTscanController);

router.post(
  "/add-mri-scan/:patientId",
  ...baseMiddlewares,
  addMRIscanController,
);

router.post(
  "/add-usm-scan/:patientId",
  ...baseMiddlewares,
  addUSMscanController,
);

router.post(
  "/add-xray-scan/:patientId",
  ...baseMiddlewares,
  addXRAYscanController,
);

router.post(
  "/add-pet-scan/:patientId",
  ...baseMiddlewares,
  addPETscanController,
);

router.post(
  "/add-spect-scan/:patientId",
  ...baseMiddlewares,
  addSPECTscanController,
);

router.post(
  "/add-eeg-scan/:patientId",
  ...baseMiddlewares,
  addEEGscanController,
);

router.post(
  "/add-ginecology-test/:patientId",
  ...baseMiddlewares,
  addGinecologyscanController,
);

router.post(
  "/add-holter-scan/:patientId/:patientModel",
  ...baseMiddlewares,
  addHOLTERscanController,
);

router.post(
  "/add-spirometry-scan/:patientId",
  ...baseMiddlewares,
  addSpirometryscanController,
);

router.post(
  "/add-dopler-scan/:patientId",
  ...baseMiddlewares,
  addDoplerscanController,
);

router.post(
  "/add-gastroscopy-scan/:patientId",
  ...baseMiddlewares,
  addGastroscopyscanController,
);

router.post(
  "/add-CapsuleEndoscopy-scan/:patientId",
  ...baseMiddlewares,
  addCapsuleEndoscopyscanController,
);

router.post(
  "/add-Angiography-scan/:patientId",
  ...baseMiddlewares,
  addAngiographyscanController,
);

router.post(
  "/add-ekg-scan/:patientId",
  ...baseMiddlewares,
  addAEKGscanController,
);

router.post(
  "/add-echo-ekg-scan/:patientId",
  ...baseMiddlewares,
  addEchoEKGscanController,
);

router.post(
  "/add-coronography-scan/:patientId",
  ...baseMiddlewares,
  addCoronographyscanController,
);

router.post(
  "/add-labtest-scan/:patientId",
  ...baseMiddlewares,
  addLabtestscanController,
);

export default router;
