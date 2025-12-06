import { Router } from "express";
import patientDetailsController from "../controllers/patientDetailsController.js";
const router = Router();

router.get("/:id", patientDetailsController);
export default router;
