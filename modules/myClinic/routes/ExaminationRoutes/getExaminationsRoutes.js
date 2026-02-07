import { Router } from "express";

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

router.get("/CTscaner/list/:id", getListCTScanerController);
router.get("/MRIscaner/list/:id", getListMRIScanerController);
router.get("/USMscaner/list/:id", getListUSMScanerController);
router.get("/XRAYscaner/list/:id", getListXRAYScanerController);
router.get("/PETscaner/list/:id", getListPETScanerController);
router.get("/SPECTscaner/list/:id", getListSPECTScanerController);
router.get("/EEGscaner/list/:id", getListEEGScanerController);
router.get("/Ginecology/list/:id", getListGinecologyScanerController);
router.get("/HOLTERscaner/list/:id", getListHolterScanerController);
router.get("/Spirometryscaner/list/:id", getListSpirometryScanerController);
router.get("/Doplerscaner/list/:id", getListDoplerScanerController);
router.get("/Gastroscopyscaner/list/:id", getListGastroscopyScanerController);
router.get(
  "/CapsuleEndoscopyscaner/list/:id",
  getListCapsuleEndoscopyScanerController
);
router.get("/Angiographyscaner/list/:id", getListAngiographyScanerController);
router.get("/EKGscaner/list/:id", getListEKGScanerController);
router.get("/EchoEKGscaner/list/:id", getListEchoEKGScanerController);

router.get("/Coronographyscaner/list/:id", getListCoronographyScanerController);
router.get("/Labtestscaner/list/:id", getListLabtestScanerController);

export default router;
