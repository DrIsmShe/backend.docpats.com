import { Router } from "express";

import tempLaboratoryTestResultsDeleteController from "../controllers/TempResultControllers/tempLaboratoryTestResultsDeleteController.js";

const router = Router();

router.delete("/:id", tempLaboratoryTestResultsDeleteController);

export default router;
