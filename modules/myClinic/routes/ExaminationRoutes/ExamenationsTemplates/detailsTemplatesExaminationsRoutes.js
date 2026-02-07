import { Router } from "express";
import controllerCTscaner from "../../../controllers/CTscanControllers/detailsTemplatesCTScanerController.js";

const router = Router();
import controllerEEGScaner from "../../../controllers/EEGscanControllers/detailsTemplatesEEGScanerController.js";
router.get(
  "/EEGscaner/recomandation/:id",
  controllerEEGScaner.detailsRecomandationTemplatesEEGScanerController
);

router.get(
  "/EEGscaner/nameofexam/:id",
  controllerEEGScaner.detailsNameofexamTemplatesEEGScanerController
);
router.get(
  "/EEGscaner/report/:id",
  controllerEEGScaner.detailsReportTemplatesEEGScanerController
);
router.get(
  "/EEGscaner/diagnosis/:id",
  controllerEEGScaner.detailsDiagnosisTemplatesEEGScanerController
);

router.get(
  "/CTscaner/nameofexam/:id",
  controllerCTscaner.detailsNameofexamTemplatesCTScanerController
);

router.get(
  "/CTscaner/report/:id",
  controllerCTscaner.detailsReportTemplatesCTScanerController
);
router.get(
  "/CTscaner/diagnosis/:id",
  controllerCTscaner.detailsDiagnosisTemplatesCTScanerController
);
router.get(
  "/CTscaner/recomandation/:id",
  controllerCTscaner.detailsRecomandationTemplatesCTScanerController
);

import controllerMRIScaner from "../../../controllers/MRIscanControllers/detailsTemplatesMRIScanerController.js";
router.get(
  "/MRIScaner/nameofexam/:id",
  controllerMRIScaner.detailsNameofexamTemplatesMRIScanerController
);
router.get(
  "/MRIScaner/report/:id",
  controllerMRIScaner.detailsReportTemplatesMRIScanerController
);
router.get(
  "/MRIScaner/diagnosis/:id",
  controllerMRIScaner.detailsDiagnosisTemplatesMRIScanerController
);
router.get(
  "/MRIScaner/recomandation/:id",
  controllerMRIScaner.detailsRecomandationTemplatesMRIScanerController
);

import controllerUSMScaner from "../../../controllers/USMscanController/detailsTemplatesUSMScanerController.js";
router.get(
  "/USMScaner/nameofexam/:id",
  controllerUSMScaner.detailsNameofexamTemplatesUSMScanerController
);
router.get(
  "/USMScaner/report/:id",
  controllerUSMScaner.detailsReportTemplatesUSMScanerController
);
router.get(
  "/USMScaner/diagnosis/:id",
  controllerUSMScaner.detailsDiagnosisTemplatesUSMScanerController
);
router.get(
  "/USMScaner/recomandation/:id",
  controllerUSMScaner.detailsRecomandationTemplatesUSMScanerController
);

import controllerXRAYScaner from "../../../controllers/XRAYscanControllers/detailsTemplatesXRAYScanerController.js";
router.get(
  "/XRAYScaner/nameofexam/:id",
  controllerXRAYScaner.detailsNameofexamTemplatesXRAYScanerController
);
router.get(
  "/XRAYScaner/report/:id",
  controllerXRAYScaner.detailsReportTemplatesXRAYScanerController
);
router.get(
  "/XRAYScaner/diagnosis/:id",
  controllerXRAYScaner.detailsDiagnosisTemplatesXRAYScanerController
);
router.get(
  "/XRAYScaner/recomandation/:id",
  controllerXRAYScaner.detailsRecomandationTemplatesXRAYScanerController
);

import controllerPETScaner from "../../../controllers/PETscanControllers/detailsTemplatesPETScanerController.js";
router.get(
  "/PETScaner/nameofexam/:id",
  controllerPETScaner.detailsNameofexamTemplatesPETScanerController
);
router.get(
  "/PETScaner/report/:id",
  controllerPETScaner.detailsReportTemplatesPETScanerController
);
router.get(
  "/PETScaner/diagnosis/:id",
  controllerPETScaner.detailsDiagnosisTemplatesPETScanerController
);
router.get(
  "/PETScaner/recomandation/:id",
  controllerPETScaner.detailsRecomandationTemplatesPETScanerController
);

import controllerSPECTScaner from "../../../controllers/SPECTscanControllers/detailsTemplatesSPECTScanerController.js";
router.get(
  "/SPECTScaner/nameofexam/:id",
  controllerSPECTScaner.detailsNameofexamTemplatesSPECTScanerController
);
router.get(
  "/SPECTScaner/report/:id",
  controllerSPECTScaner.detailsReportTemplatesSPECTScanerController
);
router.get(
  "/SPECTScaner/diagnosis/:id",
  controllerSPECTScaner.detailsDiagnosisTemplatesSPECTScanerController
);
router.get(
  "/SPECTScaner/recomandation/:id",
  controllerSPECTScaner.detailsRecomandationTemplatesSPECTScanerController
);

import controllerGinecologyScaner from "../../../controllers/GinecologyscanController/detailsTemplatesGinecologyScanerController.js";
router.get(
  "/Ginecology/nameofexam/:id",
  controllerGinecologyScaner.detailsNameofexamTemplatesGinecologyScanerController
);
router.get(
  "/Ginecology/report/:id",
  controllerGinecologyScaner.detailsReportTemplatesGinecologyScanerController
);
router.get(
  "/Ginecology/diagnosis/:id",
  controllerGinecologyScaner.detailsDiagnosisTemplatesGinecologyScanerController
);
router.get(
  "/Ginecology/recomandation/:id",
  controllerGinecologyScaner.detailsRecomandationTemplatesGinecologyScanerController
);

import controllerHOLTERScaner from "../../../controllers/HOLTERscanController/detailsTemplatesHOLTERScanerController.js";
router.get(
  "/HOLTERScaner/nameofexam/:id",
  controllerHOLTERScaner.detailsNameofexamTemplatesHOLTERScanerController
);
router.get(
  "/HOLTERScaner/report/:id",
  controllerHOLTERScaner.detailsReportTemplatesHOLTERScanerController
);
router.get(
  "/HOLTERScaner/diagnosis/:id",
  controllerHOLTERScaner.detailsDiagnosisTemplatesHOLTERScanerController
);
router.get(
  "/HOLTERScaner/recomandation/:id",
  controllerHOLTERScaner.detailsRecomandationTemplatesHOLTERScanerController
);

import controllerSpirometryScaner from "../../../controllers/SpirometryscanControllers/detailsTemplatesSpirometryScanerController.js";
router.get(
  "/Spirometryscaner/nameofexam/:id",
  controllerSpirometryScaner.detailsNameofexamTemplatesSpirometryScanerController
);
router.get(
  "/Spirometryscaner/report/:id",
  controllerSpirometryScaner.detailsReportTemplatesSpirometryScanerController
);
router.get(
  "/Spirometryscaner/diagnosis/:id",
  controllerSpirometryScaner.detailsDiagnosisTemplatesSpirometryScanerController
);
router.get(
  "/Spirometryscaner/recomandation/:id",
  controllerSpirometryScaner.detailsRecomandationTemplatesSpirometryScanerController
);

import controllerDoplerScaner from "../../../controllers/DoplerscanController/detailsTemplatesDoplerScanerController.js";
router.get(
  "/Doplerscaner/nameofexam/:id",
  controllerDoplerScaner.detailsNameofexamTemplatesDoplerScanerController
);
router.get(
  "/Doplerscaner/report/:id",
  controllerDoplerScaner.detailsReportTemplatesDoplerScanerController
);
router.get(
  "/Doplerscaner/diagnosis/:id",
  controllerDoplerScaner.detailsDiagnosisTemplatesDoplerScanerController
);
router.get(
  "/Doplerscaner/recomandation/:id",
  controllerDoplerScaner.detailsRecomandationTemplatesDoplerScanerController
);

import controllerGastroscopyScaner from "../../../controllers/GastroscopyscanControllers/detailsTemplatesGastroscopyScanerController.js";
router.get(
  "/Gastroscopyscaner/nameofexam/:id",
  controllerGastroscopyScaner.detailsNameofexamTemplatesGastroscopyScanerController
);
router.get(
  "/Gastroscopyscaner/report/:id",
  controllerGastroscopyScaner.detailsReportTemplatesGastroscopyScanerController
);
router.get(
  "/Gastroscopyscaner/diagnosis/:id",
  controllerGastroscopyScaner.detailsDiagnosisTemplatesGastroscopyScanerController
);
router.get(
  "/Gastroscopyscaner/recomandation/:id",
  controllerGastroscopyScaner.detailsRecomandationTemplatesGastroscopyScanerController
);

import controllerCapsuleEndoscopyScaner from "../../../controllers/CapsuleEndoscopyscanControllers/detailsTemplatesCapsuleEndoscopyScanerController.js";
router.get(
  "/CapsuleEndoscopyscaner/nameofexam/:id",
  controllerCapsuleEndoscopyScaner.detailsNameofexamTemplatesCapsuleEndoscopyScanerController
);
router.get(
  "/CapsuleEndoscopyscaner/report/:id",
  controllerCapsuleEndoscopyScaner.detailsReportTemplatesCapsuleEndoscopyScanerController
);
router.get(
  "/CapsuleEndoscopyscaner/diagnosis/:id",
  controllerCapsuleEndoscopyScaner.detailsDiagnosisTemplatesCapsuleEndoscopyScanerController
);
router.get(
  "/CapsuleEndoscopyscaner/recomandation/:id",
  controllerCapsuleEndoscopyScaner.detailsRecomandationTemplatesCapsuleEndoscopyScanerController
);

import controllerAngiographyscaner from "../../../controllers/AngiographyscanController/detailsTemplatesAngiographyScanerController.js";
router.get(
  "/Angiographyscaner/nameofexam/:id",
  controllerAngiographyscaner.detailsNameofexamTemplatesAngiographyScanerController
);
router.get(
  "/Angiographyscaner/report/:id",
  controllerAngiographyscaner.detailsReportTemplatesAngiographyScanerController
);
router.get(
  "/Angiographyscaner/diagnosis/:id",
  controllerAngiographyscaner.detailsDiagnosisTemplatesAngiographyScanerController
);
router.get(
  "/Angiographyscaner/recomandation/:id",
  controllerAngiographyscaner.detailsRecomandationTemplatesAngiographyScanerController
);

import controllerEKGscaner from "../../../controllers/EKGscanController/detailsTemplatesEKGScanerController.js";
router.get(
  "/EKGscaner/nameofexam/:id",
  controllerEKGscaner.detailsNameofexamTemplatesEKGScanerController
);
router.get(
  "/EKGscaner/report/:id",
  controllerEKGscaner.detailsReportTemplatesEKGScanerController
);
router.get(
  "/EKGscaner/diagnosis/:id",
  controllerEKGscaner.detailsDiagnosisTemplatesEKGScanerController
);
router.get(
  "/EKGscaner/recomandation/:id",
  controllerEKGscaner.detailsDiagnosisTemplatesEKGScanerController
);

import controllerEchoEKGscaner from "../../../controllers/EchoEKGscanController/detailsTemplatesEchoEKGScanerController.js";
router.get(
  "/EchoEKGscaner/nameofexam/:id",
  controllerEchoEKGscaner.detailsNameofexamTemplatesEchoEKGScanerController
);
router.get(
  "/EchoEKGscaner/report/:id",
  controllerEchoEKGscaner.detailsReportTemplatesEchoEKGScanerController
);
router.get(
  "/EchoEKGscaner/diagnosis/:id",
  controllerEchoEKGscaner.detailsDiagnosisTemplatesEchoEKGScanerController
);
router.get(
  "/EchoEKGscaner/recomandation/:id",
  controllerEchoEKGscaner.detailsRecomandationTemplatesEchoEKGScanerController
);

import controllerCoronographyscaner from "../../../controllers/CoronographyscanController/detailsTemplatesCoronographyScanerController.js";
router.get(
  "/Coronographyscaner/nameofexam/:id",
  controllerCoronographyscaner.detailsNameofexamTemplatesCoronographyScanerController
);
router.get(
  "/Coronographyscaner/report/:id",
  controllerCoronographyscaner.detailsReportTemplatesCoronographyScanerController
);
router.get(
  "/Coronographyscaner/diagnosis/:id",
  controllerCoronographyscaner.detailsDiagnosisTemplatesCoronographyScanerController
);
router.get(
  "/Coronographyscaner/recomandation/:id",
  controllerCoronographyscaner.detailsRecomandationTemplatesCoronographyScanerController
);

export default router;
