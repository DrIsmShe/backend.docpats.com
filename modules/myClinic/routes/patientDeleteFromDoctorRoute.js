import { Router } from "express";
import patientDeleteFromDoctorController from "../controllers/patientDeleteFromDoctorController.js";
import authMidleWeare from "../../../common/middlewares/authMiddleware.js";
import resolvePatient from "../../../common/middlewares/resolvePatient.js";
const router = Router();

router.delete(
  "/:id",
  authMidleWeare,
  resolvePatient,
  patientDeleteFromDoctorController,
);
export default router;
