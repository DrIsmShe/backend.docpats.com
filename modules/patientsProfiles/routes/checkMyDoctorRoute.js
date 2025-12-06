import { Router } from "express";
import authMiddleware from "../../../common/middlewares/authMiddleware.js";
import { checkMyDoctor } from "../controllers/checkMyDoctorController.js";

const router = Router();
// ждём userId доктора (НЕ profileId)
router.get("/:doctorId", authMiddleware, checkMyDoctor);

export default router;
