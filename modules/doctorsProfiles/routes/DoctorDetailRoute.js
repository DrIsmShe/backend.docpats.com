import { Router } from "express";
import DoctorDetailController from "../controllers/DoctorDetailController.js";

const router = Router();
router.get("/:id", DoctorDetailController);
export default router;
