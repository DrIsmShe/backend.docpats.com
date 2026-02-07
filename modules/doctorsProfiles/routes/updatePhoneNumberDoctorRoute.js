import { Router } from "express";
import updatePhoneNumberDoctorController from "../controllers/updatePhoneNumberDoctorController.js";
const router = Router();

router.put("/", updatePhoneNumberDoctorController);

export default router;
