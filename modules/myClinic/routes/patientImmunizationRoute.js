import { Router } from "express";
import addPatientImmunizationController from "../controllers/addPatientImmunizationController.js";
const router = Router();

router.post("/:id", addPatientImmunizationController);
export default router;
