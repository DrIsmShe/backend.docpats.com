import { Router } from "express";

const router = Router();

import controllerCTscaner from "../../../controllers/CTscanControllers/addTemplateCTscanerController.js";

router.post(
  "/CTscaner/nameofexam",
  controllerCTscaner.addTemplateCTscanerControllerNameofexam
);
router.post(
  "/CTscaner/report",
  controllerCTscaner.addTemplateCTscanerControllerReport
);
router.post(
  "/CTscaner/diagnosis",
  controllerCTscaner.addTemplateCTscanerControllerDiagnosis
);
router.post(
  "/CTscaner/recomandation",
  controllerCTscaner.addTemplateCTscanerControlleRecomandation
);

import controllerMRIscaner from "../../../controllers/MRIscanControllers/addTemplatesMRIscanerController.js";

router.post(
  "/MRIscaner/nameofexam",
  controllerMRIscaner.addTemplateMRIscanerControllerNameofexam
);
router.post(
  "/MRIscaner/report",
  controllerMRIscaner.addTemplateMRIscanerControllerReport
);
router.post(
  "/MRIscaner/diagnosis",
  controllerMRIscaner.addTemplateMRIscanerControllerDiagnosis
);
router.post(
  "/MRIscaner/recomandation",
  controllerMRIscaner.addTemplateMRIscanerControlleRecomandation
);

import controllerUSMscaner from "../../../controllers/USMscanController/addTemplatesUSMscanerController.js";

router.post(
  "/USMscaner/nameofexam",
  controllerUSMscaner.addTemplateUSMscanerControllerNameofexam
);
router.post(
  "/USMscaner/report",
  controllerUSMscaner.addTemplateUSMscanerControllerReport
);
router.post(
  "/USMscaner/diagnosis",
  controllerUSMscaner.addTemplateUSMscanerControllerDiagnosis
);
router.post(
  "/USMscaner/recomendation",
  controllerUSMscaner.addTemplateUSMscanerControlleRecomandation
);

import controllerXRAYscaner from "../../../controllers/XRAYscanControllers/addTemplateXRAYscanerController.js";

router.post(
  "/XRAYscaner/nameofexam",
  controllerXRAYscaner.addTemplateXRAYscanerControllerNameofexam
);
router.post(
  "/XRAYscaner/report",
  controllerXRAYscaner.addTemplateXRAYscanerControllerReport
);
router.post(
  "/XRAYscaner/diagnosis",
  controllerXRAYscaner.addTemplateXRAYscanerControllerDiagnosis
);
router.post(
  "/XRAYscaner/recomandation",
  controllerXRAYscaner.addTemplateXRAYscanerControlleRecomandation
);

import controllerPETscaner from "../../../controllers/PETscanControllers/addTemplatePETscanerController.js";

router.post(
  "/PETscaner/nameofexam",
  controllerPETscaner.addTemplatePETscanerControllerNameofexam
);
router.post(
  "/PETscaner/report",
  controllerPETscaner.addTemplatePETscanerControllerReport
);
router.post(
  "/PETscaner/diagnosis",
  controllerPETscaner.addTemplatePETscanerControllerDiagnosis
);
router.post(
  "/PETscaner/recomandation",
  controllerPETscaner.addTemplatePETscanerControlleRecomandation
);

import controllerSPECTscaner from "../../../controllers/SPECTscanControllers/addTemplateSPECTscanerController.js";

router.post(
  "/SPECTscaner/nameofexam",
  controllerSPECTscaner.addTemplateSPECTscanerControllerNameofexam
);
router.post(
  "/SPECTscaner/report",
  controllerSPECTscaner.addTemplateSPECTscanerControllerReport
);
router.post(
  "/SPECTscaner/diagnosis",
  controllerSPECTscaner.addTemplateSPECTscanerControllerDiagnosis
);
router.post(
  "/SPECTscaner/recomandation",
  controllerSPECTscaner.addTemplateSPECTscanerControlleRecomandation
);

import controllerEEGscaner from "../../../controllers/EEGscanControllers/addTemplateEEGscanerController.js";

router.post(
  "/EEGscaner/nameofexam",
  controllerEEGscaner.addTemplateEEGscanerControllerNameofexam
);
router.post(
  "/EEGscaner/report",
  controllerEEGscaner.addTemplateEEGscanerControllerReport
);
router.post(
  "/EEGscaner/diagnosis",
  controllerEEGscaner.addTemplateEEGscanerControllerDiagnosis
);
router.post(
  "/EEGscaner/recomandation",
  controllerEEGscaner.addTemplateEEGscanerControlleRecomandation
);

import controllerGinecologyscaner from "../../../controllers/GinecologyscanController/addTemplatesGinecologyscanerController.js";

router.post(
  "/Ginecology/nameofexam",
  controllerGinecologyscaner.addTemplateGinecologyscanerControllerNameofexam
);
router.post(
  "/Ginecology/report",
  controllerGinecologyscaner.addTemplateGinecologyscanerControllerReport
);
router.post(
  "/Ginecology/diagnosis",
  controllerGinecologyscaner.addTemplateGinecologyscanerControllerDiagnosis
);
router.post(
  "/Ginecology/recomandation",
  controllerGinecologyscaner.addTemplateGinecologyscanerControlleRecomandation
);

import controllerHOLTERscaner from "../../../controllers/HOLTERscanController/addTemplatesHOLTERscanerController.js";

router.post(
  "/HOLTERscaner/nameofexam",
  controllerHOLTERscaner.addTemplateHOLTERscanerControllerNameofexam
);
router.post(
  "/HOLTERscaner/report",
  controllerHOLTERscaner.addTemplateHOLTERscanerControllerReport
);
router.post(
  "/HOLTERscaner/diagnosis",
  controllerHOLTERscaner.addTemplateHOLTERscanerControllerDiagnosis
);
router.post(
  "/HOLTERscaner/recomandation",
  controllerHOLTERscaner.addTemplateHOLTERscanerControlleRecomandation
);

import controllerSpirometryscaner from "../../../controllers/SpirometryscanControllers/addTemplateSpirometryscanerController.js";

router.post(
  "/Spirometryscaner/nameofexam",
  controllerSpirometryscaner.addTemplateSpirometryscanerControllerNameofexam
);
router.post(
  "/Spirometryscaner/report",
  controllerSpirometryscaner.addTemplateSpirometryscanerControllerReport
);
router.post(
  "/Spirometryscaner/diagnosis",
  controllerSpirometryscaner.addTemplateSpirometryscanerControllerDiagnosis
);
router.post(
  "/Spirometryscaner/recomandation",
  controllerSpirometryscaner.addTemplateSpirometryscanerControlleRecomandation
);

import controllerDoplerscaner from "../../../controllers/DoplerscanController/addTemplatesDoplerscanerController.js";

router.post(
  "/Doplerscaner/nameofexam",
  controllerDoplerscaner.addTemplateDoplerscanerControllerNameofexam
);
router.post(
  "/Doplerscaner/report",
  controllerDoplerscaner.addTemplateDoplerscanerControllerReport
);
router.post(
  "/Doplerscaner/diagnosis",
  controllerDoplerscaner.addTemplateDoplerscanerControllerDiagnosis
);
router.post(
  "/Doplerscaner/recomandation",
  controllerDoplerscaner.addTemplateDoplerscanerControlleRecomandation
);

import controllerGastroscopyscaner from "../../../controllers/GastroscopyscanControllers/addTemplatesGastroscopyScanerController.js";

router.post(
  "/Gastroscopyscaner/nameofexam",
  controllerGastroscopyscaner.addTemplateGastroscopyscanerControllerNameofexam
);
router.post(
  "/Gastroscopyscaner/report",
  controllerGastroscopyscaner.addTemplateGastroscopyscanerControllerReport
);
router.post(
  "/Gastroscopyscaner/diagnosis",
  controllerGastroscopyscaner.addTemplateGastroscopyscanerControllerDiagnosis
);
router.post(
  "/Gastroscopyscaner/recomandation",
  controllerGastroscopyscaner.addTemplateGastroscopyscanerControlleRecomandation
);

import controllerCapsuleEndoscopyscaner from "../../../controllers/CapsuleEndoscopyscanControllers/addTemplatesCapsuleEndoscopyScanerController.js";

router.post(
  "/CapsuleEndoscopyscaner/nameofexam",
  controllerCapsuleEndoscopyscaner.addTemplateCapsuleEndoscopyScannerControllerNameofexam
);
router.post(
  "/CapsuleEndoscopyscaner/report",
  controllerCapsuleEndoscopyscaner.addTemplateCapsuleEndoscopyScannerControllerReport
);
router.post(
  "/CapsuleEndoscopyscaner/diagnosis",
  controllerCapsuleEndoscopyscaner.addTemplateCapsuleEndoscopyScannerControllerDiagnosis
);
router.post(
  "/CapsuleEndoscopyscaner/recomandation",
  controllerCapsuleEndoscopyscaner.addTemplateCapsuleEndoscopyScannerControlleRecomandation
);

import controllerAngiographyscaner from "../../../controllers/AngiographyscanController/addTemplatesAngiographyscanerController.js";

router.post(
  "/Angiographyscaner/nameofexam",
  controllerAngiographyscaner.addTemplateAngiographyscanerControllerNameofexam
);
router.post(
  "/Angiographyscaner/report",
  controllerAngiographyscaner.addTemplateAngiographyscanerControllerReport
);
router.post(
  "/Angiographyscaner/diagnosis",
  controllerAngiographyscaner.addTemplateAngiographyscanerControllerDiagnosis
);
router.post(
  "/angiographyscaner/recomendation",
  controllerAngiographyscaner.addTemplateAngiographyscanerControlleRecomandation
);

import controllerEKGscaner from "../../../controllers/EKGscanController/addTemplatesEKGscanerController.js";

router.post(
  "/EKGscaner/nameofexam",
  controllerEKGscaner.addTemplateEKGscanerControllerNameofexam
);
router.post(
  "/EKGscaner/report",
  controllerEKGscaner.addTemplateEKGscanerControllerReport
);
router.post(
  "/EKGscaner/diagnosis",
  controllerEKGscaner.addTemplateEKGscanerControllerDiagnosis
);
router.post(
  "/EKGscaner/recomendation",
  controllerEKGscaner.addTemplateEKGscanerControlleRecomandation
);

import controllerEchoEKGscaner from "../../../controllers/EchoEKGscanController/addTemplatesEchoEKGscanerController.js";

router.post(
  "/EchoEKGscaner/nameofexam",
  controllerEchoEKGscaner.addTemplateEchoEKGscanerControllerNameofexam
);
router.post(
  "/EchoEKGscaner/report",
  controllerEchoEKGscaner.addTemplateEchoEKGscanerControllerReport
);
router.post(
  "/EchoEKGscaner/diagnosis",
  controllerEchoEKGscaner.addTemplateEchoEKGscanerControllerDiagnosis
);
router.post(
  "/EchoEKGscaner/recomendation",
  controllerEchoEKGscaner.addTemplateEchoEKGscanerControlleRecomandation
);

import controllerCoronographyscaner from "../../../controllers/CoronographyscanController/addTemplatesCoronographyscanerController.js";

router.post(
  "/Coronographyscaner/nameofexam",
  controllerCoronographyscaner.addTemplateCoronographyscanerControllerNameofexam
);
router.post(
  "/Coronographyscaner/report",
  controllerCoronographyscaner.addTemplateCoronographyscanerControllerReport
);
router.post(
  "/Coronographyscaner/diagnosis",
  controllerCoronographyscaner.addTemplateCoronographyscanerControllerDiagnosis
);
router.post(
  "/Coronographyscaner/recomendation",
  controllerCoronographyscaner.addTemplateCoronographyscanerControlleRecomandation
);

export default router;
