import { Router } from "express";
import authMiddleware from "../../../../common/middlewares/authMiddleware.js";
import resolvePatient from "../../../../common/middlewares/resolvePatient.js";

import getDetailExaminationsController from "../../controllers/CTscanControllers/getDetailExaminationsController.js";
import getDetailExaminationsControllerMRI from "../../controllers/MRIscanControllers/getDetailExaminationsController.js";
import getDetailExaminationsControllerUSM from "../../controllers/USMscanController/getDetailExaminationsControllerUSM.js";
import getDetailExaminationsControllerXRAY from "../../controllers/XRAYscanControllers/getDetailExaminationsController.js";
import getDetailExaminationsControllerPET from "../../controllers/PETscanControllers/getDetailExaminationsControllerPET.js";
import getDetailExaminationsControllerSPECT from "../../controllers/SPECTscanControllers/getDetailExaminationsControllerSPECT.js";
import getDetailExaminationsControllerEEG from "../../controllers/EEGscanControllers/getDetailExaminationsController.js";
import getDetailExaminationsControllerGinecology from "../../controllers/GinecologyscanController/getDetailExaminationsController.js";
import getDetailExaminationsControllerHOLTER from "../../controllers/HOLTERscanController/getDetailExaminationsController.js";
import getDetailExaminationsControllerHSpirometry from "../../controllers/SpirometryscanControllers/getDetailExaminationsController.js";
import getDetailExaminationsControllerDopler from "../../controllers/DoplerscanController/getDetailExaminationsController.js";
import getDetailExaminationsControllerGastroscopy from "../../controllers/GastroscopyscanControllers/getDetailExaminationsControllerGastroscopy.js";
import getDetailExaminationsControllerCapsuleEndoscopy from "../../controllers/CapsuleEndoscopyscanControllers/getDetailExaminationsControllerCapsuleEndoscopy.js";
import getDetailExaminationsControllerAngiography from "../../controllers/AngiographyscanController/getDetailExaminationsControllerAngiography.js";
import getDetailExaminationsControllerEKG from "../../controllers/EKGscanController/getDetailExaminationsControllerEKG.js";
import getDetailExaminationsControllerEchoEKG from "../../controllers/EchoEKGscanController/getDetailExaminationsControllerEchoEKG.js";
import getDetailExaminationsControllerCoronography from "../../controllers/CoronographyscanController/getDetailExaminationsControllerCoronography.js";
import getDetailExaminationsControllerLabtest from "../../controllers/LabtestscanController/getDetailExaminationsControllerLabtest.js";
import getLatestLabtestController from "../../controllers/LabtestscanController/getLatestLabtestController.js";

const router = Router();

/**
 * 🔍 DETAIL — id = ID исследования
 * ❗ resolvePatient НЕ нужен
 */

router.get(
  "/CTscaner/detail/:id",
  authMiddleware,
  getDetailExaminationsController,
);
router.get(
  "/MRIscaner/detail/:id",
  authMiddleware,
  getDetailExaminationsControllerMRI,
);
router.get(
  "/USMscaner/detail/:id",
  authMiddleware,
  getDetailExaminationsControllerUSM,
);
router.get(
  "/XRAYscaner/detail/:id",
  authMiddleware,
  getDetailExaminationsControllerXRAY,
);
router.get(
  "/PETscaner/detail/:id",
  authMiddleware,
  getDetailExaminationsControllerPET,
);
router.get(
  "/SPECTscaner/detail/:id",
  authMiddleware,
  getDetailExaminationsControllerSPECT,
);
router.get(
  "/EEGscaner/detail/:id",
  authMiddleware,
  getDetailExaminationsControllerEEG,
);
router.get(
  "/Ginecology/detail/:id",
  authMiddleware,
  getDetailExaminationsControllerGinecology,
);
router.get(
  "/HOLTERscaner/detail/:id",
  authMiddleware,
  getDetailExaminationsControllerHOLTER,
);
router.get(
  "/Spirometryscaner/detail/:id",
  authMiddleware,
  getDetailExaminationsControllerHSpirometry,
);
router.get(
  "/Doplerscaner/detail/:id",
  authMiddleware,
  getDetailExaminationsControllerDopler,
);
router.get(
  "/GastroscopyScaner/detail/:id",
  authMiddleware,
  getDetailExaminationsControllerGastroscopy,
);
router.get(
  "/CapsuleEndoscopyScaner/detail/:id",
  authMiddleware,
  getDetailExaminationsControllerCapsuleEndoscopy,
);
router.get(
  "/AngiographyScaner/detail/:id",
  authMiddleware,
  getDetailExaminationsControllerAngiography,
);
router.get(
  "/EKGScaner/detail/:id",
  authMiddleware,
  getDetailExaminationsControllerEKG,
);
router.get(
  "/EchoEKGScaner/detail/:id",
  authMiddleware,
  getDetailExaminationsControllerEchoEKG,
);
router.get(
  "/CoronographyScaner/detail/:id",
  authMiddleware,
  getDetailExaminationsControllerCoronography,
);
router.get(
  "/LabtestScaner/detail/:id",
  authMiddleware,
  getDetailExaminationsControllerLabtest,
);

/**
 * 🧪 Последний анализ — patientId
 * ❗ здесь resolvePatient НУЖЕН
 */
router.get(
  "/get-latest-labtest/:patientId",
  authMiddleware,
  resolvePatient,
  getLatestLabtestController,
);

export default router;
