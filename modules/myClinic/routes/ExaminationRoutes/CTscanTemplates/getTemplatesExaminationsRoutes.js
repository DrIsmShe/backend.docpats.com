import { Router } from "express";
import controller from "../../../controllers/CTscanControllers/getListTemplatesCTScanerController.js";

const router = Router();

router.get(
  "/CTscaner/nameofexam/:id",
  controller.getListNameofexamTemplatesCTScanerController
);
router.get(
  "/CTscaner/report/:id",
  controller.getListReportTemplatesCTScanerController
);
router.get(
  "/CTscaner/diagnosis/:id",
  controller.getListDiagnosisTemplatesCTScanerController
);
router.get(
  "/CTscaner/recomandation/:id",
  controller.getListRecomandationTemplatesCTScanerController
);

export default router;
