import { Router } from "express";
import controllerCTscaner from "../../../controllers/CTscanControllers/deleteTemplatesCTScanerController.js";

const router = Router();

router.delete(
  "/CTscaner/nameofexam/:id",
  controllerCTscaner.deleteNameofexamTemplatesCTScanerController
);

router.delete(
  "/CTscaner/report/:id",
  controllerCTscaner.deleteReportTemplatesCTScanerController
);
router.delete(
  "/CTscaner/diagnosis/:id",
  controllerCTscaner.deleteDiagnosisTemplatesCTScanerController
);
router.delete(
  "/CTscaner/recomandation/:id",
  controllerCTscaner.deleteRecomandationTemplatesCTScanerController
);

import controllerMRIscaner from "../../../controllers/MRIscanControllers/deleteTemplatesMRIScanerController.js";

router.delete(
  "/MRIscaner/nameofexam/:id",
  controllerMRIscaner.deleteNameofexamTemplatesMRIScanerController
);

router.delete(
  "/MRIscaner/report/:id",
  controllerMRIscaner.deleteReportTemplatesMRIScanerController
);
router.delete(
  "/MRIscaner/diagnosis/:id",
  controllerMRIscaner.deleteDiagnosisTemplatesMRIScanerController
);
router.delete(
  "/MRIscaner/recomandation/:id",
  controllerMRIscaner.deleteRecomandationTemplatesMRIScanerController
);

import controllerUSMscaner from "../../../controllers/USMscanController/deleteTemplatesUSMScanerController.js";

router.delete(
  "/USMscaner/nameofexam/:id",
  controllerUSMscaner.deleteNameofexamTemplatesUSMScanerController
);

router.delete(
  "/USMscaner/report/:id",
  controllerUSMscaner.deleteReportTemplatesUSMScanerController
);
router.delete(
  "/USMscaner/diagnosis/:id",
  controllerUSMscaner.deleteDiagnosisTemplatesUSMScanerController
);
router.delete(
  "/USMscaner/recomandation/:id",
  controllerUSMscaner.deleteRecomandationTemplatesUSMScanerController
);

import controllerXRAYscaner from "../../../controllers/XRAYscanControllers/deleteTemplatesXRAYScanerController.js";

router.delete(
  "/XRAYscaner/nameofexam/:id",
  controllerXRAYscaner.deleteNameofexamTemplatesXRAYScanerController
);

router.delete(
  "/XRAYscaner/report/:id",
  controllerXRAYscaner.deleteReportTemplatesXRAYScanerController
);
router.delete(
  "/XRAYscaner/diagnosis/:id",
  controllerXRAYscaner.deleteDiagnosisTemplatesXRAYScanerController
);
router.delete(
  "/XRAYscaner/recomandation/:id",
  controllerXRAYscaner.deleteRecomandationTemplatesXRAYScanerController
);

import controllerPETscaner from "../../../controllers/PETscanControllers/deleteTemplatesPETScanerController.js";

router.delete(
  "/PETscaner/nameofexam/:id",
  controllerPETscaner.deleteNameofexamTemplatesPETScanerController
);

router.delete(
  "/PETscaner/report/:id",
  controllerPETscaner.deleteReportTemplatesPETScanerController
);
router.delete(
  "/PETscaner/diagnosis/:id",
  controllerPETscaner.deleteDiagnosisTemplatesPETScanerController
);
router.delete(
  "/PETscaner/recomandation/:id",
  controllerPETscaner.deleteRecomandationTemplatesPETScanerController
);

import controllerSPECTscaner from "../../../controllers/SPECTscanControllers/deleteTemplatesSPECTScanerController.js";

router.delete(
  "/SPECTscaner/nameofexam/:id",
  controllerSPECTscaner.deleteNameofexamTemplatesSPECTScanerController
);
router.delete(
  "/SPECTscaner/report/:id",
  controllerSPECTscaner.deleteReportTemplatesSPECTScanerController
);
router.delete(
  "/SPECTscaner/diagnosis/:id",
  controllerSPECTscaner.deleteDiagnosisTemplatesSPECTScanerController
);
router.delete(
  "/SPECTscaner/recomandation/:id",
  controllerSPECTscaner.deleteRecomandationTemplatesSPECTScanerController
);

import controllerEEGscaner from "../../../controllers/EEGscanControllers/deleteTemplatesEEGScanerController.js";

router.delete(
  "/EEGscaner/nameofexam/:id",
  controllerEEGscaner.deleteNameofexamTemplatesEEGScanerController
);
router.delete(
  "/EEGscaner/report/:id",
  controllerEEGscaner.deleteReportTemplatesEEGScanerController
);
router.delete(
  "/EEGscaner/diagnosis/:id",
  controllerEEGscaner.deleteDiagnosisTemplatesEEGScanerController
);
router.delete(
  "/EEGscaner/recomandation/:id",
  controllerEEGscaner.deleteRecomandationTemplatesEEGScanerController
);

import controllerGinecologyscaner from "../../../controllers/GinecologyscanController/deleteTemplatesGinecologyScanerController.js";

router.delete(
  "/Ginecology/nameofexam/:id",
  controllerGinecologyscaner.deleteNameofexamTemplatesGinecologyScanerController
);
router.delete(
  "/Ginecology/report/:id",
  controllerGinecologyscaner.deleteReportTemplatesGinecologyScanerController
);
router.delete(
  "/Ginecology/diagnosis/:id",
  controllerGinecologyscaner.deleteDiagnosisTemplatesGinecologyScanerController
);
router.delete(
  "/Ginecology/recomandation/:id",
  controllerGinecologyscaner.deleteRecomandationTemplatesGinecologyScanerController
);

import controllerHOLTERscaner from "../../../controllers/HOLTERscanController/deleteTemplatesHOLTERScanerController.js";

router.delete(
  "/HOLTERscaner/nameofexam/:id",
  controllerHOLTERscaner.deleteNameofexamTemplatesHOLTERScanerController
);

router.delete(
  "/HOLTERscaner/report/:id",
  controllerHOLTERscaner.deleteReportTemplatesHOLTERScanerController
);
router.delete(
  "/HOLTERscaner/diagnosis/:id",
  controllerHOLTERscaner.deleteDiagnosisTemplatesHOLTERScanerController
);
router.delete(
  "/HOLTERscaner/recomandation/:id",
  controllerHOLTERscaner.deleteRecomandationTemplatesHOLTERScanerController
);

import controllerSpirometryscaner from "../../../controllers/SpirometryscanControllers/deleteTemplatesSpirometryScanerController.js";

router.delete(
  "/Spirometryscaner/nameofexam/:id",
  controllerSpirometryscaner.deleteNameofexamTemplatesSpirometryScanerController
);

router.delete(
  "/Spirometryscaner/report/:id",
  controllerSpirometryscaner.deleteReportTemplatesSpirometryScanerController
);
router.delete(
  "/Spirometryscaner/diagnosis/:id",
  controllerSpirometryscaner.deleteDiagnosisTemplatesSpirometryScanerController
);
router.delete(
  "/Spirometryscaner/recomandation/:id",
  controllerSpirometryscaner.deleteRecomandationTemplatesSpirometryScanerController
);

import controllerDoplerscaner from "../../../controllers/DoplerscanController/deleteTemplatesDoplerScanerController.js";

router.delete(
  "/Doplerscaner/nameofexam/:id",
  controllerDoplerscaner.deleteNameofexamTemplatesDoplerScanerController
);

router.delete(
  "/Doplerscaner/report/:id",
  controllerDoplerscaner.deleteReportTemplatesDoplerScanerController
);
router.delete(
  "/Doplerscaner/diagnosis/:id",
  controllerDoplerscaner.deleteDiagnosisTemplatesDoplerScanerController
);
router.delete(
  "/Doplerscaner/recomandation/:id",
  controllerDoplerscaner.deleteRecomandationTemplatesDoplerScanerController
);

import controllerGastroscopyscaner from "../../../controllers/GastroscopyscanControllers/deleteTemplatesGastroscopyScanerController.js";

router.delete(
  "/Gastroscopyscaner/nameofexam/:id",
  controllerGastroscopyscaner.deleteNameofexamTemplatesGastroscopyScanerController
);

router.delete(
  "/Gastroscopyscaner/report/:id",
  controllerGastroscopyscaner.deleteReportTemplatesGastroscopyScanerController
);
router.delete(
  "/Gastroscopyscaner/diagnosis/:id",
  controllerGastroscopyscaner.deleteDiagnosisTemplatesGastroscopyScanerController
);
router.delete(
  "/Gastroscopyscaner/recomandation/:id",
  controllerGastroscopyscaner.deleteRecomandationTemplatesGastroscopyScanerController
);

import controllerCapsuleEndoscopyscaner from "../../../controllers/CapsuleEndoscopyscanControllers/deleteTemplatesCapsuleEndoscopyScanerController.js";

router.delete(
  "/CapsuleEndoscopyscaner/nameofexam/:id",
  controllerCapsuleEndoscopyscaner.deleteNameofexamTemplatesCapsuleEndoscopyScanerController
);

router.delete(
  "/CapsuleEndoscopyscaner/report/:id",
  controllerCapsuleEndoscopyscaner.deleteReportTemplatesCapsuleEndoscopyScanerController
);
router.delete(
  "/CapsuleEndoscopyscaner/diagnosis/:id",
  controllerCapsuleEndoscopyscaner.deleteDiagnosisTemplatesCapsuleEndoscopyScanerController
);
router.delete(
  "/CapsuleEndoscopyscaner/recomandation/:id",
  controllerCapsuleEndoscopyscaner.deleteRecomandationTemplatesCapsuleEndoscopyScanerController
);

import controllerAngiographyscaner from "../../../controllers/AngiographyscanController/deleteTemplatesAngiographyScanerController.js";

router.delete(
  "/Angiographyscaner/nameofexam/:id",
  controllerAngiographyscaner.deleteNameofexamTemplateAngiographyScanerController
);

router.delete(
  "/Angiographyscaner/report/:id",
  controllerAngiographyscaner.deleteReportTemplatesAngiographyScanerController
);
router.delete(
  "/Angiographyscaner/diagnosis/:id",
  controllerAngiographyscaner.deleteDiagnosisTemplatesAngiographyScanerController
);
router.delete(
  "/Angiographyscaner/recomandation/:id",
  controllerAngiographyscaner.deleteRecomandationTemplatesAngiographyScanerController
);

import controllerEKGscaner from "../../../controllers/EKGscanController/deleteTemplatesEKGScanerController.js";

router.delete(
  "/EKGscaner/nameofexam/:id",
  controllerEKGscaner.deleteNameofexamTemplateEKGScanerController
);

router.delete(
  "/EKGscaner/report/:id",
  controllerEKGscaner.deleteReportTemplatesEKGScanerController
);
router.delete(
  "/EKGscaner/diagnosis/:id",
  controllerEKGscaner.deleteDiagnosisTemplatesEKGScanerController
);
router.delete(
  "/EKGscaner/recomandation/:id",
  controllerEKGscaner.deleteRecomandationTemplatesEKGScanerController
);

import controllerEchoEKGscaner from "../../../controllers/EchoEKGscanController/deleteTemplatesEchoEKGScanerController.js";

router.delete(
  "/EchoEKGscaner/nameofexam/:id",
  controllerEchoEKGscaner.deleteNameofexamTemplateEchoEKGScanerController
);

router.delete(
  "/EchoEKGscaner/report/:id",
  controllerEchoEKGscaner.deleteReportTemplatesEchoEKGScanerController
);
router.delete(
  "/EchoEKGscaner/diagnosis/:id",
  controllerEchoEKGscaner.deleteDiagnosisTemplatesEchoEKGScanerController
);
router.delete(
  "/EchoEKGscaner/recomandation/:id",
  controllerEchoEKGscaner.deleteRecomandationTemplatesEchoEKGScanerController
);

import controllerCoronographyscaner from "../../../controllers/CoronographyscanController/deleteTemplatesCoronographyScanerController.js";

router.delete(
  "/Coronographyscaner/nameofexam/:id",
  controllerCoronographyscaner.deleteNameofexamTemplateCoronographyScanerController
);

router.delete(
  "/Coronographyscaner/report/:id",
  controllerCoronographyscaner.deleteReportTemplatesCoronographyScanerController
);
router.delete(
  "/Coronographyscaner/diagnosis/:id",
  controllerCoronographyscaner.deleteDiagnosisTemplatesCoronographyScanerController
);
router.delete(
  "/Coronographyscaner/recomandation/:id",
  controllerCoronographyscaner.deleteRecomandationTemplatesCoronographyScanerController
);
export default router;
