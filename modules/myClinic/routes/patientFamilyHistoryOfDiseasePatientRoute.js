import { Router } from "express";
import addPatientFamilyHistoryOfDiseasePatientRouteController from "../controllers/addPatientFamilyHistoryOfDiseasePatientRouteController.js";
const router = Router();

router.post("/:id", addPatientFamilyHistoryOfDiseasePatientRouteController);
export default router;
