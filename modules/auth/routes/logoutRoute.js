import { Router } from "express";
import logoutController from "../controllers/logoutController.js";
const router = Router();
router.post("", logoutController);
export default router;
