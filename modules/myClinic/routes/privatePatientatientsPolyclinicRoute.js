import { Router } from "express";
import authMiddleware from "../../../common/middlewares/authMiddleware.js";
import getPrivatePatientsPolyclinicController from "../controllers/getPrivatePatientsPolyclinicController.js";

const router = Router();

router.get("/", authMiddleware, getPrivatePatientsPolyclinicController);

export default router;
