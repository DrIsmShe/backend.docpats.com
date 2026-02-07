import { Router } from "express";
import changePasswordProfileOfPatientController from "../controllers/changePasswordProfileOfPatientController.js";

const router = Router();

router.post("/", changePasswordProfileOfPatientController);

export default router;
