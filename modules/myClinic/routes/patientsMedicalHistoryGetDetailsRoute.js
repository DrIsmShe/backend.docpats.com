import { Router } from "express";
import patientsMedicalHistoryGetDetailsController from "../controllers/patientsMedicalHistoryGetDetailsController.js";
import authMidleWeare from "../../../common/middlewares/authMiddleware.js";
import resolvePatient from "../../../common/middlewares/resolvePatient.js";

const router = Router();

router.get("/:id", authMidleWeare, patientsMedicalHistoryGetDetailsController);
export default router;
