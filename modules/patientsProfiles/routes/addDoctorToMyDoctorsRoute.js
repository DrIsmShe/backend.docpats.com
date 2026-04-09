import { Router } from "express";
import {
  addDoctorToMyDoctors,
  checkIfDoctorInMyDoctors,
} from "../controllers/addDoctorToMyDoctors.js";
import authMiddleware from "../../../common/middlewares/authMiddleware.js"; // ОБЯЗАТЕЛЬНО

const router = Router();

// Теперь правильно:
router.post("/:id", authMiddleware, addDoctorToMyDoctors);
router.get("/:doctorId", authMiddleware, checkIfDoctorInMyDoctors);
export default router;
