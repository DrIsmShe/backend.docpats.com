import { Router } from "express";
import getSpecializationDetailDoctorController from "../controllers/getSpecializationDetailDoctorController.js";
const router = Router();
router.get("/:id", getSpecializationDetailDoctorController);
export default router;
