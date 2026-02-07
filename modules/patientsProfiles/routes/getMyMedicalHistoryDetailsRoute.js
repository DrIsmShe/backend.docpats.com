import { Router } from "express";
import getMyMedicalHistoryDetailsController from "../controllers/getMyMedicalHistoryDetailsController.js";
const router = Router();

router.get("/:id", getMyMedicalHistoryDetailsController);

export default router;
