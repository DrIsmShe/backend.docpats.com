import { Router } from "express";
import controllerCTscaner from "../../../controllers/CTscanControllers/getListTemplatesCTScanerController.js";

const router = Router();

router.get(
  "/CTscaner/nameofexam/:id",
  controllerCTscaner.getListNameofexamTemplatesCTScanerController
);
router.get(
  "/CTscaner/report/:id",
  controllerCTscaner.getListReportTemplatesCTScanerController
);
router.get(
  "/CTscaner/diagnosis/:id",
  controllerCTscaner.getListDiagnosisTemplatesCTScanerController
);
router.get(
  "/CTscaner/recomandation/:id",
  controllerCTscaner.getListRecomandationTemplatesCTScanerController
);

import controllerMRIscaner from "../../../controllers/MRIscanControllers/getListTemplatesMRIScanerController.js";
router.get(
  "/MRIscaner/nameofexam/:id",
  controllerMRIscaner.getListNameofexamTemplatesMRIscanerController
);
router.get(
  "/MRIscaner/report/:id",
  controllerMRIscaner.getListReportTemplatesMRIscanerController
);
router.get(
  "/MRIscaner/diagnosis/:id",
  controllerMRIscaner.getListDiagnosisTemplatesMRIscanerController
);
router.get(
  "/MRIscaner/recomandation/:id",
  controllerMRIscaner.getListRecomandationTemplatesMRIscanerController
);

import controllerUSMscaner from "../../../controllers/USMscanController/getListTemplatesUSMScanerController.js";
router.get(
  "/USMscaner/nameofexam/:id",
  controllerUSMscaner.getListNameofexamTemplatesUSMscanerController
);
router.get(
  "/USMscaner/report/:id",
  controllerUSMscaner.getListReportTemplatesUSMscanerController
);
router.get(
  "/USMscaner/diagnosis/:id",
  controllerUSMscaner.getListDiagnosisTemplatesUSMscanerController
);
router.get(
  "/USMscaner/recomandation/:id",
  controllerUSMscaner.getListRecomandationTemplatesUSMscanerController
);

import controllerXRAYscaner from "../../../controllers/XRAYscanControllers/getListTemplatesXRAYScanerController.js";

router.get(
  "/XRAYscaner/nameofexam/:id",
  controllerXRAYscaner.getListNameofexamTemplatesXRAYScanerController
);
router.get(
  "/XRAYscaner/report/:id",
  controllerXRAYscaner.getListReportTemplatesXRAYScanerController
);
router.get(
  "/XRAYscaner/diagnosis/:id",
  controllerXRAYscaner.getListDiagnosisTemplatesXRAYScanerController
);
router.get(
  "/XRAYscaner/recomandation/:id",
  controllerXRAYscaner.getListRecomandationTemplatesXRAYScanerController
);

import controllerPETscaner from "../../../controllers/PETscanControllers/getListTemplatesPETScanerController.js";

router.get(
  "/PETscaner/nameofexam/:id",
  controllerPETscaner.getListNameofexamTemplatesPETScanerController
);
router.get(
  "/PETscaner/report/:id",
  controllerPETscaner.getListReportTemplatesPETScanerController
);
router.get(
  "/PETscaner/diagnosis/:id",
  controllerPETscaner.getListDiagnosisTemplatesPETScanerController
);
router.get(
  "/PETscaner/recomandation/:id",
  controllerPETscaner.getListRecomandationTemplatesPETScanerController
);

import controllerSPECTscaner from "../../../controllers/SPECTscanControllers/getListTemplatesSPECTScanerController.js";

router.get(
  "/SPECTscaner/nameofexam/:id",
  controllerSPECTscaner.getListNameofexamTemplatesSPECTScanerController
);
router.get(
  "/SPECTscaner/report/:id",
  controllerSPECTscaner.getListReportTemplatesSPECTScanerController
);
router.get(
  "/SPECTscaner/diagnosis/:id",
  controllerSPECTscaner.getListDiagnosisTemplatesSPECTScanerController
);
router.get(
  "/SPECTscaner/recomandation/:id",
  controllerSPECTscaner.getListRecomandationTemplatesSPECTScanerController
);

import controllerEEGscaner from "../../../controllers/EEGscanControllers/getListTemplatesEEGScanerController.js";

router.get(
  "/EEGscaner/nameofexam/:id",
  controllerEEGscaner.getListNameofexamTemplatesEEGScanerController
);
router.get(
  "/EEGscaner/report/:id",
  controllerEEGscaner.getListReportTemplatesEEGScanerController
);
router.get(
  "/EEGscaner/diagnosis/:id",
  controllerEEGscaner.getListDiagnosisTemplatesEEGScanerController
);
router.get(
  "/EEGscaner/recomandation/:id",
  controllerEEGscaner.getListRecomandationTemplatesEEGScanerController
);

import controllerGinecologyscaner from "../../../controllers/GinecologyscanController/getListTemplatesGinecologyScanerController.js";

router.get(
  "/Ginecology/nameofexam/:id",
  controllerGinecologyscaner.getListNameofexamTemplatesGinecologyscanerController
);
router.get(
  "/Ginecology/report/:id",
  controllerGinecologyscaner.getListReportTemplatesGinecologyscanerController
);
router.get(
  "/Ginecology/diagnosis/:id",
  controllerGinecologyscaner.getListDiagnosisTemplatesGinecologyscanerController
);
router.get(
  "/Ginecology/recomandation/:id",
  controllerGinecologyscaner.getListRecomandationTemplatesGinecologyscanerController
);

import controllerHOLTERscaner from "../../../controllers/HOLTERscanController/getListTemplatesHOLTERScanerController.js";
router.get(
  "/HOLTERscaner/nameofexam/:id?",
  controllerHOLTERscaner.getListNameofexamTemplatesHOLTERscanerController
);
router.get(
  "/HOLTERscaner/report/:id?",
  controllerHOLTERscaner.getListReportTemplatesHOLTERscanerController
);
router.get(
  "/HOLTERscaner/diagnosis/:id?",
  controllerHOLTERscaner.getListDiagnosisTemplatesHOLTERscanerController
);
router.get(
  "/HOLTERscaner/recomandation/:id?",
  controllerHOLTERscaner.getListRecomandationTemplatesHOLTERscanerController
);

// алиас на прежнюю опечатку (если где-то осталась)
router.get(
  "/HOLTERIscaner/recomandation/:id?",
  controllerHOLTERscaner.getListRecomandationTemplatesHOLTERscanerController
);

import controllerSpirometryscaner from "../../../controllers/SpirometryscanControllers/getListTemplatesSpirometryScanerController.js";
router.get(
  "/Spirometryscaner/nameofexam/:id",
  controllerSpirometryscaner.getListNameofexamTemplatesSpirometryScanerController
);
router.get(
  "/Spirometryscaner/report/:id",
  controllerSpirometryscaner.getListReportTemplatesSpirometryScanerController
);
router.get(
  "/Spirometryscaner/diagnosis/:id",
  controllerSpirometryscaner.getListDiagnosisTemplatesSpirometryScanerController
);
router.get(
  "/Spirometryscaner/recomandation/:id",
  controllerSpirometryscaner.getListRecomandationTemplatesSpirometryScanerController
);

import controllerDoplerscaner from "../../../controllers/DoplerscanController/getListTemplatesDoplerScanerController.js";
router.get(
  "/Doplerscaner/nameofexam/:id",
  controllerDoplerscaner.getListNameofexamTemplatesDoplerscanerController
);
router.get(
  "/Doplerscaner/report/:id",
  controllerDoplerscaner.getListReportTemplatesDoplerscanerController
);
router.get(
  "/Doplerscaner/diagnosis/:id",
  controllerDoplerscaner.getListDiagnosisTemplatesDoplerscanerController
);
router.get(
  "/Doplerscaner/recomandation/:id",
  controllerDoplerscaner.getListRecomandationTemplatesDoplerscanerController
);

import controllerGastroscopyscaner from "../../../controllers/GastroscopyscanControllers/getListTemplatesGastroscopyScanerController.js";

router.get(
  "/Gastroscopyscaner/Gastroscopyreport/:id",
  controllerGastroscopyscaner.getListReportTemplatesGastroscopyscanerController
);
router.get(
  "/Gastroscopyscaner/nameofexam/:id",
  controllerGastroscopyscaner.getListNameofexamTemplatesGastroscopyscanerController
);
router.get(
  "/Gastroscopyscaner/diagnosis/:id",
  controllerGastroscopyscaner.getListDiagnosisTemplatesGastroscopyscanerController
);
router.get(
  "/Gastroscopyscaner/recomandation/:id",
  controllerGastroscopyscaner.getListRecomandationTemplatesGastroscopyscanerController
);

import controllerCapsuleEndoscopyscaner from "../../../controllers/CapsuleEndoscopyscanControllers/getListTemplatesCapsuleEndoscopyScanerController.js";
router.get(
  "/CapsuleEndoscopyscaner/nameofexam/:id",
  controllerCapsuleEndoscopyscaner.getListNameofexamTemplatesCapsuleEndoscopyscanerController
);
router.get(
  "/CapsuleEndoscopyscaner/report/:id",
  controllerCapsuleEndoscopyscaner.getListReportTemplatesCapsuleEndoscopyscanerController
);
router.get(
  "/CapsuleEndoscopyscaner/diagnosis/:id",
  controllerCapsuleEndoscopyscaner.getListDiagnosisTemplatesCapsuleEndoscopyscanerController
);
router.get(
  "/CapsuleEndoscopyscaner/recomandation/:id",
  controllerCapsuleEndoscopyscaner.getListRecomandationTemplatesCapsuleEndoscopyscanerController
);

export default router;
