import { Router } from "express";
import DoctorDetailsForPatientController from "../controllers/DoctorDetailsForPatientController.js";

const router = Router();
router.get("/:id", DoctorDetailsForPatientController);
export default router;
