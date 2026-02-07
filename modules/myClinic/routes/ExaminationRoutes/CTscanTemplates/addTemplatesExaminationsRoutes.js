import { Router } from "express";

const router = Router();

import controller from "../../../controllers/CTscanControllers/addTemplateCTscanerController.js";

router.post(
  "/CTscaner/nameofexam",
  controller.addTemplateCTscanerControllerNameofexam
);
router.post("/CTscaner/report", controller.addTemplateCTscanerControllerReport);
router.post(
  "/CTscaner/diagnosis",
  controller.addTemplateCTscanerControllerDiagnosis
);
router.post(
  "/CTscaner/recomandation",
  controller.addTemplateCTscanerControlleRecomandation
);

export default router;
