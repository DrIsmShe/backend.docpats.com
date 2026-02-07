import { Router } from "express";
import SearchPatientController from "../controllers/SearchPatientController.js";
import authMiddleware from "../../../common/middlewares/authMiddleware.js";
const router = Router();

router.get("/", authMiddleware, SearchPatientController);
export default router;
