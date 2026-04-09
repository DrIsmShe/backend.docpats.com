import { Router } from "express";
import countPatientsController from "./../controllers/countPatientsController.js";
import authMiddleware from "../../../common/middlewares/authMiddleware.js";
const router = Router();

router.get("/count-all-patients", authMiddleware, countPatientsController);

export default router;
