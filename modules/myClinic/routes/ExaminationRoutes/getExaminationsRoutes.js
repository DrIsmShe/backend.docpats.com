import { Router } from "express";

import authMiddleware from "../../../../common/middlewares/authMiddleware.js";
import resolvePatient from "../../../../common/middlewares/resolvePatient.js";

import getListCTScanerController from "../../controllers/CTscanControllers/getListCTScanerController.js";
import getListMRIScanerController from "../../controllers/MRIscanControllers/getListMRIScanerController.js";
import getListUSMScanerController from "../../controllers/USMscanController/getListUSMScanerController.js";
import getListXRAYScanerController from "../../controllers/XRAYscanControllers/getListXRAYScanerController.js";
import getListPETScanerController from "../../controllers/PETscanControllers/getListPETScanerController.js";
import getListSPECTScanerController from "../../controllers/SPECTscanControllers/getListSPECTScanerControllerSPECT.js";
import getListEEGScanerController from "../../controllers/EEGscanControllers/getListEEGScanerController.js";
import getListGinecologyScanerController from "../../controllers/GinecologyscanController/getListGinecologyScanerController.js";
import getListHolterScanerController from "../../controllers/HOLTERscanController/getListHOLTERScanerController.js";
import getListSpirometryScanerController from "../../controllers/SpirometryscanControllers/getListSpirometryScanerController.js";
import getListDoplerScanerController from "../../controllers/DoplerscanController/getListHDoplerScanController.js";
import getListGastroscopyScanerController from "../../controllers/GastroscopyscanControllers/getListGastroscopyScanController.js";
import getListCapsuleEndoscopyScanerController from "../../controllers/CapsuleEndoscopyscanControllers/getListCapsuleEndoscopyScanController.js";
import getListAngiographyScanerController from "../../controllers/AngiographyscanController/getListAngiographyScanerController.js";
import getListEKGScanerController from "../../controllers/EKGscanController/getListEKGScanerController.js";
import getListEchoEKGScanerController from "../../controllers/EchoEKGscanController/getListEchoEKGScanerController.js";
import getListCoronographyScanerController from "../../controllers/CoronographyscanController/getListCoronographyScanerController.js";
import getListLabtestScanerController from "../../controllers/LabtestscanController/getListLabtestScanerController.js";

const router = Router();

// общий набор мидлвар для всех get-роутов
const baseMiddlewares = [authMiddleware, resolvePatient];

router.get(
  "/CTscaner/list/:patientId",
  ...baseMiddlewares,
  getListCTScanerController,
);

router.get(
  "/MRIscaner/list/:patientId",
  ...baseMiddlewares,
  getListMRIScanerController,
);

router.get(
  "/USMscaner/list/:patientId",
  ...baseMiddlewares,
  getListUSMScanerController,
);

router.get(
  "/XRAYscaner/list/:patientId",
  ...baseMiddlewares,
  getListXRAYScanerController,
);

router.get(
  "/PETscaner/list/:patientId",
  ...baseMiddlewares,
  getListPETScanerController,
);

router.get(
  "/SPECTscaner/list/:patientId",
  ...baseMiddlewares,
  getListSPECTScanerController,
);

router.get(
  "/EEGscaner/list/:patientId",
  ...baseMiddlewares,
  getListEEGScanerController,
);

router.get(
  "/Ginecology/list/:patientId",
  ...baseMiddlewares,
  getListGinecologyScanerController,
);

router.get(
  "/HOLTERscaner/list/:patientId",
  ...baseMiddlewares,
  getListHolterScanerController,
);

router.get(
  "/Spirometryscaner/list/:patientId",
  ...baseMiddlewares,
  getListSpirometryScanerController,
);

router.get(
  "/Doplerscaner/list/:patientId",
  ...baseMiddlewares,
  getListDoplerScanerController,
);

router.get(
  "/Gastroscopyscaner/list/:patientId",
  ...baseMiddlewares,
  getListGastroscopyScanerController,
);

router.get(
  "/CapsuleEndoscopyscaner/list/:patientId",
  ...baseMiddlewares,
  getListCapsuleEndoscopyScanerController,
);

router.get(
  "/Angiographyscaner/list/:patientId",
  ...baseMiddlewares,
  getListAngiographyScanerController,
);

router.get(
  "/EKGscaner/list/:patientId",
  ...baseMiddlewares,
  getListEKGScanerController,
);

router.get(
  "/EchoEKGscaner/list/:patientId",
  ...baseMiddlewares,
  getListEchoEKGScanerController,
);

router.get(
  "/Coronographyscaner/list/:patientId",
  ...baseMiddlewares,
  getListCoronographyScanerController,
);

router.get(
  "/Labtestscaner/list/:patientId",
  ...baseMiddlewares,
  getListLabtestScanerController,
);

export default router;
