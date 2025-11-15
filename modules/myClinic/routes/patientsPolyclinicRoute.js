import { Router } from "express";
import patientsPolyclinicController from "../controllers/patientsPolyclinicController.js";
import authMiddleware from "../../../common/middlewares/authMiddleware.js";
const router = Router();

router.get("/:userId", authMiddleware, patientsPolyclinicController);
export default router;
