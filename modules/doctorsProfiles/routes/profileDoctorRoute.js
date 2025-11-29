import { Router } from "express";

import authMiddleware from "../../../common/middlewares/authvalidateMiddleware/authMiddleware.js";
import ProfileControllerDoctor from "../controllers/profileDoctorController.js";
const router = Router();

router.post("/", authMiddleware, ProfileControllerDoctor);

export default router;
