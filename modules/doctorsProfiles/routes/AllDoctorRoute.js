import { Router } from "express";
import AllDoctorController from "../controllers/AllDoctorController.js";
const router = Router();

router.get("/", AllDoctorController);

export default router;
