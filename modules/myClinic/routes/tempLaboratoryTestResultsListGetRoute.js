import { Router } from "express";
import tempLaboratoryTestResultsListGetController from "../controllers/TempResultControllers/tempLaboratoryTestResultsListGetController.js";

const router = Router();

router.get("/", tempLaboratoryTestResultsListGetController);

export default router;
