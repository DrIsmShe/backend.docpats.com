import { Router } from "express";
import controller from "../../../controllers/CTscanControllers/detailsTemplatesCTScanerController.js";

const router = Router();

router.get(
  "/CTscaner/nameofexam/:id",
  controller.detailsNameofexamTemplatesCTScanerController
);

router.get(
  "/CTscaner/report/:id",
  controller.detailsReportTemplatesCTScanerController
);
router.get(
  "/CTscaner/diagnosis/:id",
  controller.detailsDiagnosisTemplatesCTScanerController
);
router.get(
  "/CTscaner/recomandation/:id",
  controller.detailsRecomandationTemplatesCTScanerController
);

export default router;
