import { Router } from "express";
import profileMainUpdatePatientController from "../controllers/profileMainUpdatePatientController.js";

const router = Router();

router.post("/", profileMainUpdatePatientController);

export default router;
