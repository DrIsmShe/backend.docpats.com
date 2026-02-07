import { Router } from "express";
import authMiddleware from "../../../common/middlewares/authMiddleware.js";
import { removeDoctorFromMyDoctors } from "../controllers/removeDoctorFromMyDoctorsController.js";

const router = Router();

// ждём userId доктора в URL
router.delete("/:doctorId", authMiddleware, removeDoctorFromMyDoctors);

export default router;
