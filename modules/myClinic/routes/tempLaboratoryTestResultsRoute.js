import { Router } from "express";
import tempLaboratoryTestResultsController from "../controllers/TempResultControllers/tempLaboratoryTestResultsController.js";
import authMidleWeare from "../../../common/middlewares/authMiddleware.js";
const router = Router();

router.post("/", authMidleWeare, tempLaboratoryTestResultsController);
export default router;
