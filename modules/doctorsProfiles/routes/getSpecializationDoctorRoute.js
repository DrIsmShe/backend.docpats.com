import { Router } from "express";
import getSpecializationDoctorController from "../controllers/getSpecializationDoctorController.js";
const router = Router();
router.get("/", getSpecializationDoctorController);
export default router;
