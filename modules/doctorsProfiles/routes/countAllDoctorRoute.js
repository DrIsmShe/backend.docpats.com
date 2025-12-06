import { Router } from "express";
import countAllDoctorController from "./../controllers/countAllDoctorController.js";
const router = Router();

router.get("/count-all-doctors", countAllDoctorController);

export default router;
