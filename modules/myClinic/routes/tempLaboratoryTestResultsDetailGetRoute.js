import { Router } from "express";
import tempLaboratoryTestResultsDetailGetController from "../controllers/TempResultControllers/tempLaboratoryTestResultsDetailGetController.js";

const router = Router();

router.get("/:id", tempLaboratoryTestResultsDetailGetController);

export default router;
