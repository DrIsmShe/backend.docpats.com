import { Router } from "express";
import authMidleWeare from "../../../common/middlewares/authMiddleware.js";
import {
  createDoctorPrescription,
  listDoctorPrescriptions,
  doctorPrescriptionPdf,
} from "../controllers/doctorPrescriptionsController.js";

const router = Router();

// resolvePatient здесь намеренно НЕ используется: он находит карту по
// идентификатору, но не проверяет, чья она. Для рецепта этого мало —
// владение проверяет сам контроллер.
router.get("/patient/:patientId", authMidleWeare, listDoctorPrescriptions);
router.post("/patient/:patientId", authMidleWeare, createDoctorPrescription);
router.get("/:id/pdf", authMidleWeare, doctorPrescriptionPdf);

export default router;
