import { Router } from "express";
import countAllDoctorForPatientController from "../controllers/countAllDoctorForPatientController.js";
const router = Router();

router.get("/count-doctors-all", countAllDoctorForPatientController);

export default router;
