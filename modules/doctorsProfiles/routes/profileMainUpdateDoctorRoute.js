import { Router } from "express";
import profileMainUpdateDoctorController from "../controllers/profileMainUpdateDoctorController.js";

const router = Router();

router.post("/", profileMainUpdateDoctorController);

export default router;
