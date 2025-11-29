import { Router } from "express";
import changePasswordProfileController from "../controllers/changePasswordProfileController.js";

const router = Router();

router.post("/", changePasswordProfileController);

export default router;
