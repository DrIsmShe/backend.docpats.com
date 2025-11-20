import { Router } from "express";
import AllDoctorForPatientController from "../controllers/AllDoctorForPatientController.js";
const router = Router();

router.get("/", AllDoctorForPatientController);

export default router;
