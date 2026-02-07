import { Router } from "express";
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

router.get("/CTscaner/detail/:id", getDetailExaminationsController);
router.get("/MRIscaner/detail/:id", getDetailExaminationsControllerMRI);
router.get("/USMscaner/detail/:id", getDetailExaminationsControllerUSM);
router.get("/XRAYscaner/detail/:id", getDetailExaminationsControllerXRAY);
router.get("/PETscaner/detail/:id", getDetailExaminationsControllerPET);
router.get("/SPECTscaner/detail/:id", getDetailExaminationsControllerSPECT);
router.get("/EEGscaner/detail/:id", getDetailExaminationsControllerEEG);
router.get("/Ginecology/detail/:id", getDetailExaminationsControllerGinecology);
router.get("/HOLTERscaner/detail/:id", getDetailExaminationsControllerHOLTER);
router.get(
  "/Spirometryscaner/detail/:id",
  getDetailExaminationsControllerHSpirometry
);
router.get("/Doplerscaner/detail/:id", getDetailExaminationsControllerDopler);
router.get(
  "/GastroscopyScaner/detail/:id",
  getDetailExaminationsControllerGastroscopy
);

router.get(
  "/CapsuleEndoscopyScaner/detail/:id",
  getDetailExaminationsControllerCapsuleEndoscopy
);
router.get(
  "/AngiographyScaner/detail/:id",
  getDetailExaminationsControllerAngiography
);
router.get("/EKGScaner/detail/:id", getDetailExaminationsControllerEKG);
router.get("/EchoEKGScaner/detail/:id", getDetailExaminationsControllerEchoEKG);
router.get(
  "/CoronographyScaner/detail/:id",
  getDetailExaminationsControllerCoronography
);

router.get("/LabtestScaner/detail/:id", getDetailExaminationsControllerLabtest);
router.get("/get-latest-labtest/:patientId", getLatestLabtestController);
export default router;
