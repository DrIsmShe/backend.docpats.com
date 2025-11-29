import { Router } from "express";
import controller from "../../../controllers/CTscanControllers/deleteTemplatesCTScanerController.js";

const router = Router();

router.delete(
  "/CTscaner/nameofexam/:id",
  controller.deleteNameofexamTemplatesCTScanerController
);

router.delete(
  "/CTscaner/report/:id",
  controller.deleteReportTemplatesCTScanerController
);
router.delete(
  "/CTscaner/diagnosis/:id",
  controller.deleteDiagnosisTemplatesCTScanerController
);
router.delete(
  "/CTscaner/recomandation/:id",
  controller.deleteRecomandationTemplatesCTScanerController
);

export default router;
