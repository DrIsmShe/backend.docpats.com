import { Router } from "express";
import patientDetailsController from "../controllers/patientDetailsController.js";
import authMidleWeare from "../../../common/middlewares/authMiddleware.js";
import resolvePatient from "../../../common/middlewares/resolvePatient.js";
const router = Router();

router.get("/:id", authMidleWeare, resolvePatient, patientDetailsController);
export default router;
