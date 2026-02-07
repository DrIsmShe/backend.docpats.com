import { Router } from "express";
import patientSearchPolyclinicController from "../controllers/patientSearchPolyclinicController.js";
import authMiddleware from "../../../common/middlewares/authMiddleware.js";
const router = Router();

router.get("/", authMiddleware, patientSearchPolyclinicController);
export default router;
