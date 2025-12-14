import { Router } from "express";
import addPatientAllergiesController from "../controllers/addPatientAllergiesController.js";
const router = Router();

router.post("/:id", addPatientAllergiesController);
export default router;
