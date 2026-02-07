import { Router } from "express";

import getProfileUserPatientController from "../controllers/getProfileUserPatientController.js";
import authMiddleware from "../../../common/middlewares/authMiddleware.js";
const router = Router();

router.get("/:id", authMiddleware, getProfileUserPatientController);

export default router;
