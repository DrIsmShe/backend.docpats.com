import { Router } from "express";
import patientsMedicalHistoryGetController from "../controllers/patientsMedicalHistoryGetController.js";
import authMidleWeare from "../../../common/middlewares/authMiddleware.js";
import resolvePatient from "../../../common/middlewares/resolvePatient.js";

const router = Router();

router.get(
  "/:id",
  authMidleWeare,
  resolvePatient,
  patientsMedicalHistoryGetController,
);
export default router;
