import { Router } from "express";
import addPatientChronicDiseasesPatientController from "../controllers/addPatientChronicDiseasesPatientController.js";
const router = Router();

router.post("/:id", addPatientChronicDiseasesPatientController);
export default router;
