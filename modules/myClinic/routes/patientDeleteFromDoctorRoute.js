import { Router } from "express";
import patientDeleteFromDoctorController from "../controllers/patientDeleteFromDoctorController.js";
const router = Router();

router.delete("/:id", patientDeleteFromDoctorController);
export default router;
