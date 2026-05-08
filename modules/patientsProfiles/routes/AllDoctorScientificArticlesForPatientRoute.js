import { Router } from "express";
import AllDoctorScientificArticlesForPatientController from "../controllers/AllDoctorScientificArticlesForPatientController.js";

const router = Router();
router.get("/:id", AllDoctorScientificArticlesForPatientController);
export default router;
