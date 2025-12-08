import { Router } from "express";
import controllerCTscaner from "../controllers/CTscanControllers/updateTemplatesCTScanerController.js";

const router = Router();

router.put(
  "/CTscaner/nameofexam/:id",
  controllerCTscaner.updateNameofexamTemplatesCTScanerController
);

router.put(
  "/CTscaner/report/:id",
  controllerCTscaner.updateReportTemplatesCTScanerController
);
router.put(
  "/CTscaner/diagnosis/:id",
  controllerCTscaner.updateDiagnosisTemplatesCTScanerController
);
router.put(
  "/CTscaner/recomandation/:id",
  controllerCTscaner.updateRecomandationTemplatesCTScanerController
);

import controllerMRIscaner from "../controllers/MRIscanControllers/updateTemplatesMRIScanerController.js";

router.put(
  "/MRIscaner/nameofexam/:id",
  controllerMRIscaner.updateNameofexamTemplatesMRIScanerController
);

router.put(
  "/MRIscaner/report/:id",
  controllerMRIscaner.updateReportTemplatesMRIScanerController
);
router.put(
  "/MRIscaner/diagnosis/:id",
  controllerMRIscaner.updateDiagnosisTemplatesMRIScanerController
);
router.put(
  "/MRIscaner/recomandation/:id",
  controllerMRIscaner.updateRecomandationTemplatesMRIScanerController
);

import controllerUSMscaner from "../controllers/USMscanController/updateTemplatesUSMScanerController.js";

router.put(
  "/USMscaner/nameofexam/:id",
  controllerUSMscaner.updateNameofexamTemplatesUSMScanerController
);

router.put(
  "/USMscaner/report/:id",
  controllerUSMscaner.updateReportTemplatesUSMScanerController
);
router.put(
  "/USMscaner/diagnosis/:id",
  controllerUSMscaner.updateDiagnosisTemplatesUSMScanerController
);
router.put(
  "/USMscaner/recomandation/:id",
  controllerUSMscaner.updateRecomandationTemplatesUSMScanerController
);

import controllerXRAYscaner from "../controllers/XRAYscanControllers/updateTemplatesXRAYScanerController.js";

router.put(
  "/XRAYscaner/nameofexam/:id",
  controllerXRAYscaner.updateNameofexamTemplatesXRAYScanerController
);

router.put(
  "/XRAYscaner/report/:id",
  controllerXRAYscaner.updateReportTemplatesXRAYScanerController
);
router.put(
  "/XRAYscaner/diagnosis/:id",
  controllerXRAYscaner.updateDiagnosisTemplatesXRAYScanerController
);
router.put(
  "/XRAYscaner/recomandation/:id",
  controllerXRAYscaner.updateRecomandationTemplatesXRAYScanerController
);

import controllerPETscaner from "../controllers/PETscanControllers/updateTemplatesPETScanerController.js";

router.put(
  "/PETscaner/nameofexam/:id",
  controllerPETscaner.updateNameofexamTemplatesPETScanerController
);

router.put(
  "/PETscaner/report/:id",
  controllerPETscaner.updateReportTemplatesPETScanerController
);
router.put(
  "/PETscaner/diagnosis/:id",
  controllerPETscaner.updateDiagnosisTemplatesPETScanerController
);
router.put(
  "/PETscaner/recomandation/:id",
  controllerPETscaner.updateRecomandationTemplatesPETScanerController
);
import controllerSPECTscaner from "../controllers/SPECTscanControllers/updateTemplatesSPECTScanerController.js";

router.put(
  "/SPECTscaner/nameofexam/:id",
  controllerSPECTscaner.updateNameofexamTemplatesSPECTScanerController
);

router.put(
  "/SPECTscaner/report/:id",
  controllerSPECTscaner.updateReportTemplatesSPECTScanerController
);
router.put(
  "/SPECTscaner/diagnosis/:id",
  controllerSPECTscaner.updateDiagnosisTemplatesSPECTScanerController
);
router.put(
  "/SPECTscaner/recomandation/:id",
  controllerSPECTscaner.updateRecomandationTemplatesSPECTScanerController
);

import controllerEEGscaner from "../controllers/EEGscanControllers/updateTemplatesEEGScanerController.js";

router.put(
  "/EEGscaner/nameofexam/:id",
  controllerEEGscaner.updateNameofexamTemplatesEEGScanerController
);

router.put(
  "/EEGscaner/report/:id",
  controllerEEGscaner.updateReportTemplatesEEGScanerController
);
router.put(
  "/EEGscaner/diagnosis/:id",
  controllerEEGscaner.updateDiagnosisTemplatesEEGScanerController
);
router.put(
  "/EEGscaner/recomandation/:id",
  controllerEEGscaner.updateRecomandationTemplatesEEGScanerController
);

import controllerGinecologyscaner from "../controllers/GinecologyscanController/updateTemplatesGinecologyScanerController.js";

router.put(
  "/Ginecology/nameofexam/:id",
  controllerGinecologyscaner.updateNameofexamTemplatesGinecologyScanerController
);

router.put(
  "/Ginecology/report/:id",
  controllerGinecologyscaner.updateReportTemplatesGinecologyScanerController
);
router.put(
  "/Ginecology/diagnosis/:id",
  controllerGinecologyscaner.updateDiagnosisTemplatesGinecologyScanerController
);
router.put(
  "/Ginecology/recomandation/:id",
  controllerGinecologyscaner.updateRecomandationTemplatesGinecologyScanerController
);

import controllerHOLTERscaner from "../controllers/HOLTERscanController/updateTemplatesHOLTERScanerController.js";

router.put(
  "/HOLTERscaner/nameofexam/:id",
  controllerHOLTERscaner.updateNameofexamTemplatesHOLTERScanerController
);

router.put(
  "/HOLTERscaner/report/:id",
  controllerHOLTERscaner.updateReportTemplatesHOLTERScanerController
);
router.put(
  "/HOLTERscaner/diagnosis/:id",
  controllerHOLTERscaner.updateDiagnosisTemplatesHOLTERScanerController
);
router.put(
  "/HOLTERscaner/recomandation/:id",
  controllerHOLTERscaner.updateRecomandationTemplatesHOLTERScanerController
);

import controllerSpirometryscaner from "../controllers/SpirometryscanControllers/updateTemplatesSpirometryScanerController.js";

router.put(
  "/Spirometryscaner/nameofexam/:id",
  controllerSpirometryscaner.updateNameofexamTemplatesSpirometryScanerController
);

router.put(
  "/Spirometryscaner/report/:id",
  controllerSpirometryscaner.updateReportTemplatesSpirometryScanerController
);
router.put(
  "/Spirometryscaner/diagnosis/:id",
  controllerSpirometryscaner.updateDiagnosisTemplatesSpirometryScanerController
);
router.put(
  "/Spirometryscaner/recomandation/:id",
  controllerSpirometryscaner.updateRecomandationTemplatesSpirometryScanerController
);

import controllerDoplerscaner from "../controllers/DoplerscanController/updateTemplatesDoplerScanerController.js";

router.put(
  "/Doplerscaner/nameofexam/:id",
  controllerDoplerscaner.updateNameofexamTemplatesDoplerScanerController
);

router.put(
  "/Doplerscaner/report/:id",
  controllerDoplerscaner.updateReportTemplatesDoplerScanerController
);
router.put(
  "/Doplerscaner/diagnosis/:id",
  controllerDoplerscaner.updateDiagnosisTemplatesDoplerScanerController
);
router.put(
  "/Doplerscaner/recomandation/:id",
  controllerDoplerscaner.updateRecomandationTemplatesDoplerScanerController
);

import controllerGastroscopyscaner from "../controllers/GastroscopyscanControllers/updateTemplatesGastroscopyScanerController.js";

router.put(
  "/Gastroscopyscaner/nameofexam/:id",
  controllerGastroscopyscaner.updateNameofexamTemplatesGastroscopyScanerController
);

router.put(
  "/Gastroscopyscaner/report/:id",
  controllerGastroscopyscaner.updateReportTemplatesGastroscopyScanerController
);
router.put(
  "/Gastroscopyscaner/diagnosis/:id",
  controllerGastroscopyscaner.updateDiagnosisTemplatesGastroscopyScanerController
);
router.put(
  "/Gastroscopyscaner/recomandation/:id",
  controllerGastroscopyscaner.updateRecomandationTemplatesGastroscopyScanerController
);

import controllerCapsuleEndoscopyscaner from "../controllers/CapsuleEndoscopyscanControllers/updateTemplatesGastroscopyScanerController.js";

router.put(
  "/CapsuleEndoscopyscaner/nameofexam/:id",
  controllerCapsuleEndoscopyscaner.updateNameofexamTemplatesCapsuleEndoscopyScanerController
);

router.put(
  "/CapsuleEndoscopyscaner/report/:id",
  controllerCapsuleEndoscopyscaner.updateReportTemplatesCapsuleEndoscopyScanerController
);
router.put(
  "/CapsuleEndoscopyscaner/diagnosis/:id",
  controllerCapsuleEndoscopyscaner.updateDiagnosisTemplatesCapsuleEndoscopyScanerController
);
router.put(
  "/CapsuleEndoscopyscaner/recomandation/:id",
  controllerCapsuleEndoscopyscaner.updateRecomandationTemplatesCapsuleEndoscopyScanerController
);

import controllerAngiographyscaner from "../controllers/AngiographyscanController/updateTemplatesAngiographyScanerController.js";

router.put(
  "/Angiographyscaner/nameofexam/:id",
  controllerAngiographyscaner.updateNameofexamTemplatesAngiographyScanerController
);

router.put(
  "/Angiographyscaner/report/:id",
  controllerAngiographyscaner.updateReportTemplatesAngiographyScanerController
);
router.put(
  "/Angiographyscaner/diagnosis/:id",
  controllerAngiographyscaner.updateDiagnosisTemplatesAngiographyScanerController
);
router.put(
  "/Angiographyscaner/recomandation/:id",
  controllerAngiographyscaner.updateRecomandationTemplatesAngiographyScanerController
);

import controllerEKGscaner from "../controllers/EKGscanController/updateTemplatesEKGScanerController.js";

router.put(
  "/EKGscaner/nameofexam/:id",
  controllerEKGscaner.updateNameofexamTemplatesEKGScanerController
);

router.put(
  "/EKGscaner/report/:id",
  controllerEKGscaner.updateReportTemplatesEKGScanerController
);
router.put(
  "/EKGscaner/diagnosis/:id",
  controllerEKGscaner.updateDiagnosisTemplatesEKGScanerController
);
router.put(
  "/EKGscaner/recomandation/:id",
  controllerEKGscaner.updateRecomandationTemplatesEKGScanerController
);

import controllerEchoEKGscaner from "../controllers/EchoEKGscanController/updateTemplatesEchoEKGScanerController.js";

router.put(
  "/EchoEKGscaner/nameofexam/:id",
  controllerEchoEKGscaner.updateNameofexamTemplatesEchoEKGScanerController
);

router.put(
  "/EchoEKGscaner/report/:id",
  controllerEchoEKGscaner.updateReportTemplatesEchoEKGScanerController
);
router.put(
  "/EchoEKGscaner/diagnosis/:id",
  controllerEchoEKGscaner.updateDiagnosisTemplatesEchoEKGScanerController
);
router.put(
  "/EchoEKGscaner/recomandation/:id",
  controllerEchoEKGscaner.updateRecomandationTemplatesEchoEKGScanerController
);

import controllerCoronographyscaner from "../controllers/CoronographyscanController/updateTemplatesAngiographyScanerController.js";

router.put(
  "/Coronographyscaner/nameofexam/:id",
  controllerCoronographyscaner.updateNameofexamTemplatesCoronographyScanerController
);

router.put(
  "/Coronographyscaner/report/:id",
  controllerCoronographyscaner.updateReportTemplatesCoronographyScanerController
);
router.put(
  "/Coronographyscaner/diagnosis/:id",
  controllerCoronographyscaner.updateDiagnosisTemplatesCoronographyScanerController
);
router.put(
  "/Coronographyscaner/recomandation/:id",
  controllerCoronographyscaner.updateRecomandationTemplatesCoronographyScanerController
);

export default router;
